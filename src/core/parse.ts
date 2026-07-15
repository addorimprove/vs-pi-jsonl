import { projectSession } from './normalize.js';
import {
  appendDiagnostic,
  DEFAULT_PARSE_LIMITS,
  MAX_CONTENT_BLOCKS,
  type Diagnostic,
  type ItemKind,
  type NormalizedEntry,
  type ParseInput,
  type ParseLimits,
  type ParseResult,
  type ParsedContent,
  type ParsedHeader,
  type SafeScalar,
  type SessionVersion
} from './schema.js';

export type {
  Diagnostic,
  ItemKind,
  NormalizedEntry,
  NormalizedSessionModel,
  ParseInput,
  ParseLimits,
  ParseResult,
  ParsedContent,
  ParsedHeader,
  SessionSummary,
  SessionVersion
} from './schema.js';
export { DEFAULT_PARSE_LIMITS, MAX_CONTENT_BLOCKS, MAX_DIAGNOSTICS } from './schema.js';

type JsonObject = Record<string, unknown>;

interface RawRecord {
  readonly value: JsonObject;
  readonly line: number;
}

interface SanitizedLimits {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxRecordBytes: number;
  readonly maxDepth: number;
  readonly maxStringChars: number;
  readonly maxItems: number;
}

const textDecoder = new TextDecoder('utf-8', { fatal: false });

/**
 * Parses only caller-provided bytes. It has no filesystem, VS Code, DOM, or Pi
 * runtime dependency; document content failures always become diagnostics.
 */
export function parsePiSession(input: ParseInput): ParseResult {
  const framingDiagnostics: Diagnostic[] = [];
  const semanticDiagnostics: Diagnostic[] = [];
  const limits = sanitizeLimits(input?.limits);
  const bytes = input?.bytes instanceof Uint8Array ? input.bytes : new Uint8Array();
  const bytesRead = Math.min(bytes.byteLength, limits.maxBytes);
  let truncated = bytes.byteLength > bytesRead;

  if (truncated) {
    diagnose(framingDiagnostics, 'byte-limit', 'warning', undefined, 'Stopped after the configured byte limit.', {
      count: bytes.byteLength,
      limit: limits.maxBytes
    });
  }

  const physicalLineCount = countPhysicalLines(bytes, bytesRead);
  const linesSeen = Math.min(physicalLineCount, limits.maxLines);
  if (physicalLineCount > limits.maxLines) {
    truncated = true;
    diagnose(framingDiagnostics, 'record-limit', 'warning', limits.maxLines + 1, 'Stopped after the configured line limit.', {
      count: physicalLineCount,
      limit: limits.maxLines
    });
  }

  let header: ParsedHeader | undefined;
  let version: SessionVersion = 'unknown';
  let firstMeaningful = true;
  const records: NormalizedEntry[] = [];
  const ids = new Set<string>();
  const ordinalIds = new Map<number, string>();
  let previousV1Id: string | null = null;
  let framedOrdinal = 0;
  const lateHeaderLines: number[] = [];
  let lineStart = 0;

  // Frame directly from the supplied buffer to avoid a second full decoded
  // copy and a 50k-element split array on every debounced refresh.
  for (let physicalLine = 1; physicalLine <= linesSeen; physicalLine += 1) {
    const newline = bytes.indexOf(0x0A, lineStart);
    let lineEnd = newline === -1 || newline > bytesRead ? bytesRead : newline;
    if (lineEnd > lineStart && bytes[lineEnd - 1] === 0x0D) {
      lineEnd -= 1;
    }
    let contentStart = lineStart;
    if (physicalLine === 1 && hasUtf8Bom(bytes, contentStart, lineEnd)) {
      contentStart += 3;
    }
    const recordBytes = lineEnd - contentStart;
    if (recordBytes > limits.maxRecordBytes && !isAsciiWhitespace(bytes, contentStart, lineEnd)) {
      diagnose(framingDiagnostics, 'record-limit', 'warning', physicalLine, 'Skipped a record exceeding the configured byte limit.', {
        count: recordBytes,
        limit: limits.maxRecordBytes
      });
      lineStart = newline === -1 || newline >= bytesRead ? bytesRead : newline + 1;
      continue;
    }

    const line = textDecoder.decode(bytes.subarray(contentStart, lineEnd));
    if (line.trim() !== '') {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        const isIncompleteTail = physicalLine === physicalLineCount && lineEnd === bytesRead && bytes[bytesRead - 1] !== 0x0A;
        diagnose(
          framingDiagnostics,
          'invalid-json',
          'warning',
          physicalLine,
          isIncompleteTail ? 'Skipped an incomplete trailing JSON record.' : 'Skipped malformed JSON.'
        );
        lineStart = newline === -1 || newline >= bytesRead ? bytesRead : newline + 1;
        continue;
      }

      if (!isJsonObject(value)) {
        diagnose(framingDiagnostics, 'non-object-record', 'warning', physicalLine, 'Skipped a JSONL record that is not an object.');
      } else if (exceedsDepth(value, limits.maxDepth)) {
        diagnose(framingDiagnostics, 'depth-limit', 'warning', physicalLine, 'Skipped a record exceeding the configured nesting limit.', {
          limit: limits.maxDepth
        });
      } else {
        const ordinal = framedOrdinal++;
        if (firstMeaningful) {
          firstMeaningful = false;
          if (value.type === 'session') {
            header = normalizeHeader({ value, line: physicalLine }, semanticDiagnostics, limits);
            version = header.version;
            lineStart = newline === -1 || newline >= bytesRead ? bytesRead : newline + 1;
            continue;
          }
        }
        if (value.type === 'session') {
          lateHeaderLines.push(physicalLine);
        } else if (records.length >= limits.maxItems) {
          truncated = true;
          diagnose(semanticDiagnostics, 'record-limit', 'warning', physicalLine, 'Stopped after the configured entry limit.', {
            count: records.length + 1,
            limit: limits.maxItems
          });
          break;
        } else {
          const entry = normalizeEntry({ value, line: physicalLine }, version, previousV1Id, semanticDiagnostics, limits);
          if (entry !== undefined && !ids.has(entry.id)) {
            ids.add(entry.id);
            records.push(entry);
            ordinalIds.set(ordinal, entry.id);
            if (version === 1) {
              previousV1Id = entry.id;
            }
          } else if (entry !== undefined) {
            diagnose(semanticDiagnostics, 'duplicate-id', 'warning', physicalLine, `Skipped duplicate entry ID “${entry.id}”.`);
          }
        }
      }
    }
    lineStart = newline === -1 || newline >= bytesRead ? bytesRead : newline + 1;
  }
  if (lateHeaderLines.length > 0) {
    semanticDiagnostics.unshift(...lateHeaderLines.map((line) => ({
      code: 'duplicate-header',
      severity: 'warning' as const,
      line,
      message: 'Ignored a late or duplicate session header.'
    })));
  }
  if (header === undefined) {
    diagnose(semanticDiagnostics, 'missing-header', 'warning', undefined, 'No Pi session header was found.');
  }

  if (version === 1) {
    rewriteV1CompactionIndexes(records, ordinalIds, semanticDiagnostics);
  }

  const diagnostics: Diagnostic[] = [];
  for (const diagnostic of framingDiagnostics) {
    appendDiagnostic(diagnostics, diagnostic);
  }
  for (const diagnostic of semanticDiagnostics) {
    appendDiagnostic(diagnostics, diagnostic);
  }
  const projection = projectSession({ records, ...(header === undefined ? {} : { header }), diagnostics, maxItems: limits.maxItems });

  const result: ParseResult = {
    model: projection.model,
    diagnostics: projection.diagnostics,
    source: freezeObject({ bytesRead, linesSeen, version, truncated }),
    records: freezeArray(records),
    ...(header === undefined ? {} : { header })
  };
  return freezeObject(result);
}

function normalizeHeader(record: RawRecord, diagnostics: Diagnostic[], limits: SanitizedLimits): ParsedHeader {
  const declaredVersion = record.value.version;
  let version: SessionVersion = 'unknown';
  if (declaredVersion === undefined) {
    version = 1;
  } else if (declaredVersion === 1 || declaredVersion === 2 || declaredVersion === 3) {
    version = declaredVersion;
  } else {
    diagnose(
      diagnostics,
      'unsupported-version',
      'warning',
      record.line,
      typeof declaredVersion === 'number' && declaredVersion > 3
        ? `Session version ${declaredVersion} is newer than this preview supports; using best-effort parsing.`
        : 'The session header has an unsupported version; using best-effort parsing.'
    );
  }

  const fields = scalarFields(record.value, new Set(['type', 'version', 'id', 'timestamp', 'cwd']), limits);
  const sessionId = boundedString(record.value.id, limits.maxStringChars, diagnostics, record.line);
  const timestamp = boundedString(record.value.timestamp, limits.maxStringChars, diagnostics, record.line);
  const cwd = boundedString(record.value.cwd, limits.maxStringChars, diagnostics, record.line);
  return freezeObject({
    sourceLine: record.line,
    version,
    ...(typeof declaredVersion === 'number' && Number.isFinite(declaredVersion) ? { declaredVersion } : {}),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(cwd === undefined ? {} : { cwd }),
    fields: freezeObject(fields)
  });
}

function normalizeEntry(
  record: RawRecord,
  version: SessionVersion,
  previousV1Id: string | null,
  diagnostics: Diagnostic[],
  limits: SanitizedLimits
): NormalizedEntry | undefined {
  const type = record.value.type;
  if (typeof type !== 'string' || type.trim() === '') {
    diagnose(diagnostics, 'unsupported-entry', 'warning', record.line, 'Skipped an entry without a string type.');
    return undefined;
  }

  const v1 = version === 1;
  const id = v1 ? `v1:${record.line}` : readId(record.value.id, record.line, diagnostics, limits);
  if (id === undefined) {
    return undefined;
  }

  let parentId: string | null = v1 ? previousV1Id : null;
  let parentIdWasInvalid = false;
  if (!v1 && record.value.parentId !== null && record.value.parentId !== undefined) {
    const value = boundedString(record.value.parentId, limits.maxStringChars, diagnostics, record.line);
    if (value === undefined || value.trim() === '') {
      parentIdWasInvalid = true;
      diagnose(diagnostics, 'unsupported-entry', 'warning', record.line, 'Entry parentId must be a string or null; retained as an unlinked record.');
    } else {
      parentId = value;
    }
  } else if (!v1 && record.value.parentId === undefined) {
    parentIdWasInvalid = true;
    diagnose(diagnostics, 'unsupported-entry', 'warning', record.line, 'Entry is missing parentId; retained as an unlinked record.');
  }

  const message = type === 'message' ? normalizeMessage(record.value.message, version, record.line, diagnostics, limits) : undefined;
  const kind = entryKind(type, message?.role);
  const hidden = type === 'custom_message' && record.value.display !== true;
  const fields = scalarFields(record.value, new Set(['id', 'parentId', 'type', 'timestamp', 'message', 'details', 'data', 'content']), limits);
  addDisplayFields(fields, record.value, type, limits, diagnostics, record.line);
  if (message !== undefined) {
    Object.assign(fields, message.fields);
  }
  const timestamp = boundedString(record.value.timestamp, limits.maxStringChars, diagnostics, record.line);

  return freezeObject({
    id,
    parentId,
    ...(parentIdWasInvalid ? { parentIdWasInvalid: true } : {}),
    sourceLine: record.line,
    type,
    kind,
    ...(timestamp === undefined ? {} : { timestamp }),
    ...(message?.role === undefined ? {} : { role: message.role }),
    content: freezeArray(message?.content ?? normalizeEntryContent(record.value, type, record.line, diagnostics, limits)),
    fields: freezeObject(fields),
    ...(hidden ? { hidden: true } : {})
  });
}

function normalizeMessage(
  value: unknown,
  version: SessionVersion,
  line: number,
  diagnostics: Diagnostic[],
  limits: SanitizedLimits
): { readonly role?: string; readonly content: ParsedContent[]; readonly fields: Record<string, SafeScalar> } | undefined {
  if (!isJsonObject(value)) {
    diagnose(diagnostics, 'unsupported-entry', 'warning', line, 'Message entry has no object-shaped message payload.');
    return undefined;
  }
  const rawRole = value.role;
  const role = rawRole === 'hookMessage' && version === 3 ? 'custom' : boundedString(rawRole, limits.maxStringChars, diagnostics, line);
  if (role === undefined || role.trim() === '') {
    diagnose(diagnostics, 'unsupported-entry', 'warning', line, 'Message entry has no string role.');
  }
  const fields: Record<string, SafeScalar> = Object.create(null) as Record<string, SafeScalar>;
  const displayKeys = role === 'toolResult'
    ? ['toolCallId', 'toolName', 'isError']
    : role === 'bashExecution'
      ? ['command', 'output', 'exitCode', 'cancelled']
      : role === 'assistant'
        ? ['provider', 'model', 'stopReason', 'errorMessage']
        : role === 'custom'
          ? ['customType', 'display']
          : [];
  for (const key of displayKeys) {
    const scalar = toSafeScalar(value[key], limits, diagnostics, line);
    if (scalar !== undefined) {
      fields[key] = scalar;
    }
  }
  return {
    ...(role === undefined ? {} : { role }),
    content: normalizeContent(value.content, line, diagnostics, limits),
    fields: freezeObject(fields)
  };
}

function normalizeEntryContent(
  value: JsonObject,
  type: string,
  line: number,
  diagnostics: Diagnostic[],
  limits: SanitizedLimits
): ParsedContent[] {
  if (type === 'custom_message') {
    return normalizeContent(value.content, line, diagnostics, limits);
  }
  if (type === 'compaction' || type === 'branch_summary') {
    return typeof value.summary === 'string'
      ? [textContent(value.summary, limits, diagnostics, line)]
      : [];
  }
  if (!isKnownEntryType(type) && value.content !== undefined) {
    return normalizeContent(value.content, line, diagnostics, limits);
  }
  return [];
}

function normalizeContent(value: unknown, line: number, diagnostics: Diagnostic[], limits: SanitizedLimits): ParsedContent[] {
  if (typeof value === 'string') {
    return [textContent(value, limits, diagnostics, line)];
  }
  if (!Array.isArray(value)) {
    return value === undefined ? [] : [freezeObject({ kind: 'unknown', metadata: freezeObject({ valueType: valueType(value) }) })];
  }

  const content: ParsedContent[] = [];
  const retained = value.length > MAX_CONTENT_BLOCKS ? MAX_CONTENT_BLOCKS - 1 : value.length;
  for (let index = 0; index < retained; index += 1) {
    const block = value[index];
    if (typeof block === 'string') {
      content.push(textContent(block, limits, diagnostics, line));
      continue;
    }
    if (!isJsonObject(block)) {
      content.push(freezeObject({ kind: 'unknown', metadata: freezeObject({ valueType: valueType(block) }) }));
      continue;
    }
    switch (block.type) {
      case 'text':
        content.push(typeof block.text === 'string' ? textContent(block.text, limits, diagnostics, line) : unknownContent(block, limits));
        break;
      case 'thinking':
        content.push(typeof block.thinking === 'string' ? thinkingContent(block.thinking, limits, diagnostics, line) : unknownContent(block, limits));
        break;
      case 'toolCall': {
        const name = boundedString(block.name, limits.maxStringChars, diagnostics, line);
        const callId = boundedString(block.id, limits.maxStringChars, diagnostics, line);
        const argumentsValue = stringifyBounded(block.arguments, Math.min(limits.maxStringChars, 16_000));
        content.push(freezeObject({
          kind: 'toolCall',
          ...(callId === undefined ? {} : { callId }),
          ...(name === undefined ? {} : { name }),
          ...(argumentsValue === undefined ? {} : { argumentsText: argumentsValue.text }),
          ...(argumentsValue?.truncated === true ? { truncated: true } : {})
        }));
        break;
      }
      case 'image': {
        const originalSize = typeof block.data === 'string' ? block.data.length : 0;
        content.push(freezeObject({
          kind: 'media',
          omitted: freezeObject({ reason: 'media-omitted', originalSize })
        }));
        break;
      }
      default:
        content.push(unknownContent(block, limits));
    }
  }
  if (value.length > retained) {
    diagnose(diagnostics, 'content-block-limit', 'warning', line, 'Additional content blocks were omitted by the preview limit.', {
      count: value.length,
      limit: MAX_CONTENT_BLOCKS
    });
    content.push(freezeObject({
      kind: 'unknown',
      omitted: freezeObject({ reason: 'content-block-limit', originalSize: value.length })
    }));
  }
  return content;
}

function textContent(value: string, limits: SanitizedLimits, diagnostics: Diagnostic[], line: number): ParsedContent {
  return contentString('text', value, limits, diagnostics, line);
}

function thinkingContent(value: string, limits: SanitizedLimits, diagnostics: Diagnostic[], line: number): ParsedContent {
  return contentString('thinking', value, limits, diagnostics, line);
}

function contentString(
  kind: 'text' | 'thinking',
  value: string,
  limits: SanitizedLimits,
  diagnostics: Diagnostic[],
  line: number
): ParsedContent {
  const truncated = value.length > limits.maxStringChars;
  if (truncated) {
    diagnose(diagnostics, 'string-truncated', 'warning', line, 'Display text was truncated to the configured string limit.', {
      count: value.length,
      limit: limits.maxStringChars
    });
  }
  return freezeObject({ kind, text: value.slice(0, limits.maxStringChars), ...(truncated ? { truncated: true } : {}) });
}

function unknownContent(value: JsonObject, limits: SanitizedLimits): ParsedContent {
  return freezeObject({
    kind: 'unknown',
    metadata: freezeObject(scalarFields(value, new Set(['type', 'text', 'thinking', 'data']), limits))
  });
}

function addDisplayFields(
  fields: Record<string, SafeScalar>,
  value: JsonObject,
  type: string,
  limits: SanitizedLimits,
  diagnostics: Diagnostic[],
  line: number
): void {
  const keysByType: Readonly<Record<string, readonly string[]>> = {
    compaction: ['summary', 'firstKeptEntryId', 'firstKeptEntryIndex', 'tokensBefore'],
    branch_summary: ['summary', 'fromId'],
    custom: ['customType'],
    custom_message: ['customType', 'display'],
    label: ['targetId', 'label'],
    session_info: ['name'],
    model_change: ['provider', 'modelId'],
    thinking_level_change: ['thinkingLevel']
  };
  for (const key of keysByType[type] ?? []) {
    const scalar = toSafeScalar(value[key], limits, diagnostics, line);
    if (scalar !== undefined) {
      fields[key] = scalar;
    }
  }
}

function rewriteV1CompactionIndexes(
  records: NormalizedEntry[],
  ordinalIds: ReadonlyMap<number, string>,
  diagnostics: Diagnostic[]
): void {
  for (let index = 0; index < records.length; index += 1) {
    const entry = records[index];
    if (entry?.type !== 'compaction') {
      continue;
    }
    const firstKeptEntryIndex = entry.fields.firstKeptEntryIndex;
    if (typeof firstKeptEntryIndex !== 'number' || !Number.isInteger(firstKeptEntryIndex)) {
      continue;
    }
    const targetId = ordinalIds.get(firstKeptEntryIndex);
    if (targetId === undefined) {
      diagnose(diagnostics, 'unsupported-entry', 'warning', entry.sourceLine, 'Compaction firstKeptEntryIndex did not reference an accepted entry.');
      continue;
    }
    const fields: Record<string, SafeScalar> = { ...entry.fields, firstKeptEntryId: targetId };
    delete fields.firstKeptEntryIndex;
    records[index] = freezeObject({ ...entry, fields: freezeObject(fields) });
  }
}

function isKnownEntryType(type: string): boolean {
  return type === 'message'
    || type === 'compaction'
    || type === 'branch_summary'
    || type === 'custom'
    || type === 'custom_message'
    || type === 'model_change'
    || type === 'thinking_level_change'
    || type === 'label'
    || type === 'session_info';
}

function entryKind(type: string, role: string | undefined): ItemKind {
  if (type === 'message') {
    switch (role) {
      case 'user': return 'user';
      case 'assistant': return 'assistant';
      case 'toolResult': return 'tool';
      case 'bashExecution': return 'bash';
      case 'custom': return 'customMessage';
      default: return 'unknown';
    }
  }
  switch (type) {
    case 'compaction': return 'compaction';
    case 'branch_summary': return 'branchSummary';
    case 'custom_message': return 'customMessage';
    case 'model_change': return 'modelChange';
    case 'thinking_level_change': return 'thinkingChange';
    case 'label': return 'label';
    case 'session_info': return 'sessionInfo';
    default: return 'unknown';
  }
}

function readId(value: unknown, line: number, diagnostics: Diagnostic[], limits: SanitizedLimits): string | undefined {
  const id = boundedString(value, limits.maxStringChars, diagnostics, line);
  if (id === undefined || id.trim() === '') {
    diagnose(diagnostics, 'invalid-id', 'warning', line, 'Skipped an entry without a valid string ID.');
    return undefined;
  }
  return id;
}

function scalarFields(value: JsonObject, excluded: ReadonlySet<string>, limits: SanitizedLimits): Record<string, SafeScalar> {
  const result: Record<string, SafeScalar> = Object.create(null) as Record<string, SafeScalar>;
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key) || excluded.has(key) || isUnsafeKey(key)) {
      continue;
    }
    const scalar = toSafeScalar(value[key], limits);
    if (scalar !== undefined) {
      result[key] = scalar;
      count += 1;
      if (count >= MAX_CONTENT_BLOCKS) {
        break;
      }
    }
  }
  return result;
}

function toSafeScalar(value: unknown, limits: SanitizedLimits, diagnostics?: Diagnostic[], line?: number): SafeScalar | undefined {
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    return boundedString(value, limits.maxStringChars, diagnostics, line);
  }
  return undefined;
}

function boundedString(value: unknown, maxChars: number, diagnostics?: Diagnostic[], line?: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value.length <= maxChars) {
    return value;
  }
  if (diagnostics !== undefined) {
    diagnose(diagnostics, 'string-truncated', 'warning', line, 'A string was truncated to the configured limit.', {
      count: value.length,
      limit: maxChars
    });
  }
  return value.slice(0, maxChars);
}

function stringifyBounded(value: unknown, maxChars: number): { readonly text: string; readonly truncated: boolean } | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parts: string[] = [];
  let remaining = maxChars;
  let truncated = false;
  let visited = 0;
  const maxVisited = 1_024;
  const append = (text: string): void => {
    if (truncated) {
      return;
    }
    if (text.length <= remaining) {
      parts.push(text);
      remaining -= text.length;
      return;
    }
    parts.push(text.slice(0, remaining));
    remaining = 0;
    truncated = true;
  };
  const appendJsonString = (text: string): void => {
    append('"');
    for (let index = 0; index < text.length && !truncated; index += 1) {
      const character = text[index] ?? '';
      switch (character) {
        case '"': append('\\"'); break;
        case '\\': append('\\\\'); break;
        case '\b': append('\\b'); break;
        case '\f': append('\\f'); break;
        case '\n': append('\\n'); break;
        case '\r': append('\\r'); break;
        case '\t': append('\\t'); break;
        default: {
          const code = character.charCodeAt(0);
          append(code < 0x20 ? `\\u${code.toString(16).padStart(4, '0')}` : character);
        }
      }
    }
    append('"');
  };
  const write = (current: unknown): void => {
    visited += 1;
    if (visited > maxVisited) {
      truncated = true;
      return;
    }
    if (current === null) {
      append('null');
    } else if (typeof current === 'string') {
      appendJsonString(current);
    } else if (typeof current === 'number' || typeof current === 'boolean') {
      append(String(current));
    } else if (Array.isArray(current)) {
      append('[');
      for (let index = 0; index < current.length && !truncated; index += 1) {
        if (index > 0) {
          append(',');
        }
        write(current[index]);
      }
      append(']');
    } else if (isJsonObject(current)) {
      append('{');
      let first = true;
      for (const key in current) {
        if (!Object.hasOwn(current, key) || isUnsafeKey(key) || truncated) {
          continue;
        }
        if (!first) {
          append(',');
        }
        appendJsonString(key);
        append(':');
        write(current[key]);
        first = false;
      }
      append('}');
    } else {
      append('null');
    }
  };
  write(value);
  return freezeObject({ text: `${parts.join('')}${truncated ? '…' : ''}`, truncated });
}

function exceedsDepth(root: JsonObject, maxDepth: number): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (depth > maxDepth) {
      return true;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        if (visit(child, depth + 1)) {
          return true;
        }
      }
    } else if (isJsonObject(value)) {
      for (const key in value) {
        if (Object.hasOwn(value, key) && visit(value[key], depth + 1)) {
          return true;
        }
      }
    }
    return false;
  };
  return visit(root, 1);
}

function sanitizeLimits(value: ParseLimits | undefined): SanitizedLimits {
  return {
    maxBytes: safeLimit(value?.maxBytes, DEFAULT_PARSE_LIMITS.maxBytes),
    maxLines: safeLimit(value?.maxLines, DEFAULT_PARSE_LIMITS.maxLines),
    maxRecordBytes: safeLimit(value?.maxRecordBytes, DEFAULT_PARSE_LIMITS.maxRecordBytes),
    maxDepth: safeLimit(value?.maxDepth, DEFAULT_PARSE_LIMITS.maxDepth),
    maxStringChars: safeLimit(value?.maxStringChars, DEFAULT_PARSE_LIMITS.maxStringChars),
    maxItems: safeLimit(value?.maxItems, DEFAULT_PARSE_LIMITS.maxItems)
  };
}

function safeLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function diagnose(
  diagnostics: Diagnostic[],
  code: string,
  severity: Diagnostic['severity'],
  line: number | undefined,
  message: string,
  detail?: { count?: number; limit?: number }
): void {
  appendDiagnostic(diagnostics, {
    code,
    severity,
    ...(line === undefined ? {} : { line }),
    message,
    ...(detail === undefined ? {} : { detail: freezeObject(detail) })
  });
}

function countPhysicalLines(bytes: Uint8Array, length: number): number {
  if (length === 0) {
    return 0;
  }
  let lines = 0;
  for (let index = 0; index < length; index += 1) {
    if (bytes[index] === 0x0A) {
      lines += 1;
    }
  }
  // A final newline terminates the preceding record; it is not an additional
  // physical JSONL record. An unterminated final record still counts.
  return lines + (bytes[length - 1] === 0x0A ? 0 : 1);
}

function hasUtf8Bom(bytes: Uint8Array, start: number, end: number): boolean {
  return end - start >= 3 && bytes[start] === 0xEF && bytes[start + 1] === 0xBB && bytes[start + 2] === 0xBF;
}

function isAsciiWhitespace(bytes: Uint8Array, start: number, end: number): boolean {
  for (let index = start; index < end; index += 1) {
    const value = bytes[index];
    if (value !== 0x09 && value !== 0x0A && value !== 0x0B && value !== 0x0C && value !== 0x0D && value !== 0x20) {
      return false;
    }
  }
  return true;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

function valueType(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  return Array.isArray(value) ? 'array' : typeof value;
}

function freezeArray<T>(values: T[]): readonly T[] {
  return Object.freeze(values.map((value) => freezeValue(value)));
}

function freezeObject<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function freezeValue<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  const stack: object[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || Object.isFrozen(current)) {
      continue;
    }
    for (const child of Object.values(current)) {
      if (typeof child === 'object' && child !== null && !Object.isFrozen(child)) {
        stack.push(child);
      }
    }
    Object.freeze(current);
  }
  return value;
}
