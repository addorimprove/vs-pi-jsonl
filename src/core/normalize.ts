import { appendDiagnostic, MAX_CONTENT_BLOCKS } from './schema.js';
import type {
  Diagnostic,
  ItemKind,
  NormalizedEntry,
  NormalizedSessionModel,
  ParsedContent,
  ParsedHeader,
  SessionVersion,
  TextBlock,
  ToolBlock,
  ViewItem
} from './schema.js';

/** Input to the pure graph/path and view-model projection stage. */
export interface ProjectionInput {
  readonly records: readonly NormalizedEntry[];
  readonly header?: ParsedHeader;
  readonly diagnostics?: readonly Diagnostic[];
  /** Maximum projected cards. Defaults to the number of accepted records. */
  readonly maxItems?: number;
}

export interface ProjectionResult {
  readonly model: NormalizedSessionModel;
  readonly diagnostics: readonly Diagnostic[];
}

interface IndexedEntry {
  readonly entry: NormalizedEntry;
  parentId: string | null;
}

interface ToolResult {
  readonly entry: NormalizedEntry;
  readonly callId?: string;
  readonly name: string;
  readonly resultText?: string;
  readonly truncated?: boolean;
  readonly isError?: boolean;
}

interface BoundedText {
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * Projects parser-safe records without I/O, mutation, DOM access, or Pi runtime
 * imports. The graph is indexed defensively even though parsePiSession has
 * already rejected duplicate IDs; this makes the boundary safe for direct use.
 */
export function projectSession(input: ProjectionInput): ProjectionResult {
  const diagnostics = [...(input.diagnostics ?? [])];
  const indexed = indexRecords(input.records, diagnostics);
  validateParentsAndCycles(indexed, diagnostics);

  const activePathIds = inferActivePath(indexed, diagnostics);
  const activeEntries = activePathIds
    .map((id) => indexed.get(id)?.entry)
    .filter((entry): entry is NormalizedEntry => entry !== undefined);
  const alternateBranchCount = countAlternateBranches(indexed, activePathIds);
  const paired = pairToolResults(activeEntries, diagnostics);
  const unboundedItems = normalizePath(activeEntries, paired);
  const maxItems = safeMaxItems(input.maxItems, input.records.length);
  const items = boundItems(unboundedItems, maxItems, diagnostics);

  if (alternateBranchCount > 0 && items.length > 0) {
    const index = items.length - 1;
    const item = items[index];
    if (item !== undefined) {
      items[index] = freezeObject({
        ...item,
        metadata: freezeObject({ ...(item.metadata ?? {}), alternateBranchCount })
      });
    }
  }

  const hiddenCustomCount = activeEntries.filter((entry) => entry.hidden === true).length;
  const name = [...activeEntries].reverse().find((entry) => entry.kind === 'sessionInfo')?.fields.name;
  const header = input.header;
  const version: SessionVersion = header?.version ?? 'unknown';
  const model: NormalizedSessionModel = freezeObject({
    summary: freezeObject({
      ...(header?.sessionId === undefined ? {} : { sessionId: header.sessionId }),
      version,
      ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(typeof name === 'string' ? { name } : {}),
      ...(activePathIds.length === 0 ? {} : { activeLeafId: activePathIds[activePathIds.length - 1] }),
      pathItemCount: items.length,
      hiddenCustomCount
    }),
    activePathIds: freezeArray(activePathIds),
    items: freezeArray(items)
  });

  return freezeObject({ model, diagnostics: freezeArray(diagnostics) });
}

function indexRecords(records: readonly NormalizedEntry[], diagnostics: Diagnostic[]): Map<string, IndexedEntry> {
  const indexed = new Map<string, IndexedEntry>();
  for (const entry of records) {
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      addDiagnostic(diagnostics, 'invalid-id', 'warning', entry.sourceLine, 'Skipped a projected record without a valid string ID.');
      continue;
    }
    if (indexed.has(entry.id)) {
      addDiagnostic(diagnostics, 'duplicate-id', 'warning', entry.sourceLine, `Skipped duplicate entry ID “${entry.id}” during projection.`);
      continue;
    }
    indexed.set(entry.id, { entry, parentId: entry.parentId });
  }
  return indexed;
}

function validateParentsAndCycles(indexed: ReadonlyMap<string, IndexedEntry>, diagnostics: Diagnostic[]): void {
  for (const [id, indexedEntry] of indexed) {
    if (indexedEntry.parentId !== null && !indexed.has(indexedEntry.parentId)) {
      addDiagnostic(
        diagnostics,
        'missing-parent',
        'warning',
        indexedEntry.entry.sourceLine,
        `Entry “${id}” references missing parent “${indexedEntry.parentId}”; treating it as an orphan root.`
      );
      indexedEntry.parentId = null;
    }
  }

  const state = new Map<string, 0 | 1 | 2>();
  for (const startId of indexed.keys()) {
    if ((state.get(startId) ?? 0) !== 0) {
      continue;
    }
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let currentId: string | null = startId;
    while (currentId !== null && (state.get(currentId) ?? 0) === 0) {
      state.set(currentId, 1);
      positions.set(currentId, chain.length);
      chain.push(currentId);
      currentId = indexed.get(currentId)?.parentId ?? null;
    }
    if (currentId !== null && state.get(currentId) === 1) {
      const cycleStart = positions.get(currentId);
      if (cycleStart !== undefined) {
        const severedId = chain[cycleStart];
        const severed = severedId === undefined ? undefined : indexed.get(severedId);
        if (severed !== undefined) {
          addDiagnostic(
            diagnostics,
            'cycle',
            'warning',
            severed.entry.sourceLine,
            `Cycle in parent links was severed at entry “${severedId}”.`
          );
          severed.parentId = null;
        }
      }
    }
    for (const id of chain) {
      state.set(id, 2);
    }
  }
}

function inferActivePath(indexed: ReadonlyMap<string, IndexedEntry>, diagnostics: Diagnostic[]): string[] {
  const entries = [...indexed.values()];
  const candidate = entries[entries.length - 1];
  if (candidate === undefined) {
    return [];
  }

  const reversePath: string[] = [];
  const seen = new Set<string>();
  let current: IndexedEntry | undefined = candidate;
  while (current !== undefined && !seen.has(current.entry.id)) {
    seen.add(current.entry.id);
    reversePath.push(current.entry.id);
    current = current.parentId === null ? undefined : indexed.get(current.parentId);
  }

  if (reversePath.length > 0) {
    return reversePath.reverse();
  }

  const fallback = [...indexed.values()].reverse().find((entry) => entry.parentId === null);
  if (fallback === undefined) {
    return [];
  }
  addDiagnostic(diagnostics, 'leaf-fallback', 'warning', fallback.entry.sourceLine, 'Used the last valid root as the active leaf.');
  return [fallback.entry.id];
}

function countAlternateBranches(indexed: ReadonlyMap<string, IndexedEntry>, activePathIds: readonly string[]): number {
  const active = new Set(activePathIds);
  let count = 0;
  for (const [id, indexedEntry] of indexed) {
    if (indexedEntry.parentId !== null && active.has(indexedEntry.parentId) && !active.has(id)) {
      count += 1;
    }
  }
  return count;
}

function pairToolResults(activeEntries: readonly NormalizedEntry[], diagnostics: Diagnostic[]): ReadonlyMap<string, ToolResult> {
  const calls = new Map<string, NormalizedEntry>();
  const callCounts = new Map<string, number>();
  const results: ToolResult[] = [];
  for (const entry of activeEntries) {
    if (entry.kind === 'assistant') {
      for (const content of entry.content) {
        if (content.kind !== 'toolCall') {
          continue;
        }
        if (content.callId === undefined || content.callId.trim() === '') {
          addDiagnostic(diagnostics, 'unsupported-entry', 'warning', entry.sourceLine, 'Tool call has no usable ID and cannot be paired with a result.');
          continue;
        }
        const count = (callCounts.get(content.callId) ?? 0) + 1;
        callCounts.set(content.callId, count);
        if (count === 1) {
          calls.set(content.callId, entry);
        } else {
          calls.delete(content.callId);
          addDiagnostic(diagnostics, 'unsupported-entry', 'warning', entry.sourceLine, `Duplicate tool call ID “${content.callId}”; its results are shown as unmatched.`);
        }
      }
    } else if (entry.kind === 'tool') {
      const callId = readString(entry.fields.toolCallId);
      const result = contentText(entry.content);
      const isError = readBoolean(entry.fields.isError);
      results.push({
        entry,
        ...(callId === undefined ? {} : { callId }),
        name: readString(entry.fields.toolName) ?? 'Unknown tool',
        ...(result === undefined ? {} : { resultText: result.text }),
        ...(result?.truncated === true ? { truncated: true } : {}),
        ...(isError === undefined ? {} : { isError })
      });
    }
  }

  const paired = new Map<string, ToolResult>();
  for (const result of results) {
    if (result.callId !== undefined && callCounts.get(result.callId) === 1 && calls.has(result.callId) && !paired.has(result.callId)) {
      paired.set(result.callId, result);
      continue;
    }
    addDiagnostic(
      diagnostics,
      'unmatched-tool-result',
      'warning',
      result.entry.sourceLine,
      result.callId === undefined ? 'Tool result has no toolCallId and is shown as an orphan.' : `Tool result for “${result.callId}” has no matching active-path call and is shown as an orphan.`
    );
  }
  return paired;
}

function normalizePath(entries: readonly NormalizedEntry[], paired: ReadonlyMap<string, ToolResult>): ViewItem[] {
  const items: ViewItem[] = [];
  const pairedEntries = new Set([...paired.values()].map((result) => result.entry.id));
  for (const entry of entries) {
    if (entry.kind === 'tool') {
      if (!pairedEntries.has(entry.id)) {
        items.push(orphanToolItem(entry));
      }
      continue;
    }
    if (entry.hidden === true) {
      continue;
    }
    if (entry.kind === 'assistant') {
      items.push(...assistantItems(entry, paired));
      continue;
    }
    const item = itemForEntry(entry);
    if (item !== undefined) {
      items.push(item);
    }
  }
  return items;
}

function assistantItems(entry: NormalizedEntry, paired: ReadonlyMap<string, ToolResult>): ViewItem[] {
  const items: ViewItem[] = [];
  let blocks: TextBlock[] = [];
  let segment = 0;
  const flush = (): void => {
    if (blocks.length === 0) {
      return;
    }
    items.push(makeItem(entry, 'assistant', `assistant:${segment}`, {
      ...(blocks.length === 0 ? {} : { blocks: freezeArray(blocks) }),
      ...(segment === 0 ? { title: 'Assistant' } : { title: 'Assistant (continued)' })
    }));
    segment += 1;
    blocks = [];
  };

  for (let index = 0; index < Math.min(entry.content.length, MAX_CONTENT_BLOCKS); index += 1) {
    const content = entry.content[index];
    if (content === undefined) {
      continue;
    }
    if (content.kind === 'toolCall') {
      flush();
      const result = content.callId === undefined ? undefined : paired.get(content.callId);
      const argumentsText = content.argumentsText;
      const resultText = result?.resultText;
      const isError = result?.isError;
      const tool: ToolBlock = freezeObject({
        ...(content.callId === undefined ? {} : { callId: content.callId }),
        name: content.name ?? 'Unnamed tool',
        ...(argumentsText === undefined ? {} : { argumentsText }),
        ...(resultText === undefined ? {} : { resultText }),
        ...(isError === undefined ? {} : { isError }),
        ...(content.truncated === true || result?.truncated === true ? { truncated: true } : {})
      });
      items.push(makeItem(entry, 'tool', `tool:${index}`, { title: tool.name, tool }));
      continue;
    }
    blocks.push(blockForContent(content));
  }
  flush();
  if (items.length === 0) {
    items.push(makeItem(entry, 'assistant', 'assistant:0', {
      title: 'Assistant',
      blocks: freezeArray([freezeObject({ kind: 'text', text: 'Assistant message contained no displayable content.' })])
    }));
  }
  return items;
}

function itemForEntry(entry: NormalizedEntry): ViewItem | undefined {
  switch (entry.kind) {
    case 'user':
      return contentItem(entry, 'user', 'User');
    case 'bash':
      return bashItem(entry);
    case 'compaction':
      return contentItem(entry, 'compaction', 'Compaction', metadataFor(entry));
    case 'branchSummary':
      return contentItem(entry, 'branchSummary', 'Branch summary', metadataFor(entry));
    case 'customMessage':
      return contentItem(entry, 'customMessage', customMessageTitle(entry), metadataFor(entry));
    case 'modelChange':
      return metadataItem(entry, 'modelChange', 'Model change');
    case 'thinkingChange':
      return metadataItem(entry, 'thinkingChange', 'Thinking level change');
    case 'label':
      return metadataItem(entry, 'label', 'Label');
    case 'sessionInfo':
      return metadataItem(entry, 'sessionInfo', 'Session information');
    case 'unknown':
      return unknownItem(entry);
    case 'assistant':
    case 'tool':
      return undefined;
  }
}

function contentItem(
  entry: NormalizedEntry,
  kind: ItemKind,
  title: string,
  metadata: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>
): ViewItem {
  const blocks = boundedBlocks(entry.content);
  if (blocks.length === 0 && kind === 'compaction') {
    blocks.push(freezeObject({ kind: 'text', text: 'Compaction summary was unavailable.' }));
  }
  return makeItem(entry, kind, 'entry', {
    title,
    ...(blocks.length === 0 ? {} : { blocks: freezeArray(blocks) }),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata: freezeObject(metadata) }),
    ...(entry.omitted === undefined ? {} : { omitted: entry.omitted })
  });
}

function customMessageTitle(entry: NormalizedEntry): string {
  switch (entry.fields.customType) {
    case 'subagent_stdout': return 'Standard output';
    case 'subagent_stderr': return 'Standard error';
    case 'subagent_truncated': return 'Transcript truncated';
    default: return entry.type === 'custom' ? 'Custom state notice' : 'Custom message';
  }
}

function metadataItem(entry: NormalizedEntry, kind: ItemKind, title: string): ViewItem {
  const metadata = metadataFor(entry);
  return makeItem(entry, kind, 'entry', {
    title,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata: freezeObject(metadata) })
  });
}

function bashItem(entry: NormalizedEntry): ViewItem {
  const output = contentText(entry.content) ?? boundToolText(readString(entry.fields.output));
  const commandText = boundToolText(readString(entry.fields.command));
  const tool: ToolBlock = freezeObject({
    name: 'bash',
    ...(commandText === undefined ? {} : { argumentsText: commandText.text }),
    ...(output === undefined ? {} : { resultText: output.text }),
    ...(commandText?.truncated === true || output?.truncated === true ? { truncated: true } : {}),
    ...(readBoolean(entry.fields.cancelled) === true || (typeof entry.fields.exitCode === 'number' && entry.fields.exitCode !== 0) ? { isError: true } : {})
  });
  return makeItem(entry, 'bash', 'entry', {
    title: 'Bash',
    tool,
    ...(Object.keys(metadataFor(entry)).length === 0 ? {} : { metadata: freezeObject(metadataFor(entry)) })
  });
}

function orphanToolItem(entry: NormalizedEntry): ViewItem {
  const callId = readString(entry.fields.toolCallId);
  const result = contentText(entry.content);
  const isError = readBoolean(entry.fields.isError);
  const tool: ToolBlock = freezeObject({
    ...(callId === undefined ? {} : { callId }),
    name: readString(entry.fields.toolName) ?? 'Unknown tool',
    ...(result === undefined ? {} : { resultText: result.text }),
    ...(result?.truncated === true ? { truncated: true } : {}),
    ...(isError === undefined ? {} : { isError }),
    unmatchedResult: true
  });
  return makeItem(entry, 'tool', 'orphan', { title: 'Unmatched tool result', tool });
}

function unknownItem(entry: NormalizedEntry): ViewItem {
  const metadata = metadataFor(entry);
  const blocks = boundedBlocks(entry.content);
  if (blocks.length === 0) {
    blocks.push(freezeObject({ kind: 'text', text: 'No safe display content was retained for this unsupported entry.' }));
  }
  return makeItem(entry, 'unknown', 'entry', {
    title: `Unknown entry: ${escapeUnknownText(entry.type)}`,
    blocks: freezeArray(blocks),
    ...(Object.keys(metadata).length === 0 ? {} : { metadata: freezeObject(metadata) }),
    ...(entry.omitted === undefined ? {} : { omitted: entry.omitted })
  });
}

function makeItem(
  entry: NormalizedEntry,
  kind: ItemKind,
  suffix: string,
  payload: Omit<ViewItem, 'key' | 'sourceId' | 'sourceLine' | 'kind' | 'timestamp'>
): ViewItem {
  return freezeObject({
    key: `${entry.id}:${suffix}`,
    sourceId: entry.id,
    sourceLine: entry.sourceLine,
    kind,
    ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
    ...payload
  });
}

function blockForContent(content: ParsedContent): TextBlock {
  if (content.kind === 'media') {
    return freezeObject({
      kind: 'text',
      text: `Media omitted (${content.omitted?.reason ?? 'media-omitted'}${content.omitted?.originalSize === undefined ? '' : `, ${content.omitted.originalSize} characters`}).`
    });
  }
  if (content.omitted !== undefined) {
    return freezeObject({
      kind: 'text',
      text: `Content omitted (${content.omitted.reason}${content.omitted.originalSize === undefined ? '' : `, ${content.omitted.originalSize} blocks`}).`
    });
  }
  if (content.kind === 'text' || content.kind === 'thinking') {
    return freezeObject({
      kind: content.kind,
      text: content.text ?? '',
      ...(content.truncated === true ? { truncated: true } : {})
    });
  }
  return freezeObject({ kind: 'text', text: 'Unsupported content omitted safely.' });
}

function boundedBlocks(content: readonly ParsedContent[]): TextBlock[] {
  return content.slice(0, MAX_CONTENT_BLOCKS).map(blockForContent);
}

function boundToolText(value: string | undefined): BoundedText | undefined {
  if (value === undefined) {
    return undefined;
  }
  const maxChars = 16_000;
  return freezeObject({ text: value.slice(0, maxChars), truncated: value.length > maxChars });
}

function contentText(content: readonly ParsedContent[]): BoundedText | undefined {
  const maxChars = 16_000;
  let text = '';
  for (const block of boundedBlocks(content)) {
    const separator = text === '' ? '' : '\n\n';
    const remaining = maxChars - text.length - separator.length;
    if (remaining <= 0) {
      return freezeObject({ text, truncated: true });
    }
    if (block.text.length > remaining) {
      return freezeObject({ text: `${text}${separator}${block.text.slice(0, remaining)}`, truncated: true });
    }
    text += `${separator}${block.text}`;
  }
  return text === '' ? undefined : freezeObject({ text, truncated: false });
}

function metadataFor(entry: NormalizedEntry): Record<string, string | number | boolean> {
  const metadata: Record<string, string | number | boolean> = Object.create(null) as Record<string, string | number | boolean>;
  for (const [key, value] of Object.entries(entry.fields)) {
    if (key !== 'summary' && value !== null) {
      metadata[key] = value;
    }
  }
  if (entry.role !== undefined) {
    metadata.role = entry.role;
  }
  return metadata;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function boundItems(items: ViewItem[], maxItems: number, diagnostics: Diagnostic[]): ViewItem[] {
  if (items.length <= maxItems) {
    return items;
  }
  addDiagnostic(diagnostics, 'record-limit', 'warning', undefined, 'Projected cards exceeded the configured limit; retained the latest cards.', {
    count: items.length,
    limit: maxItems
  });
  return items.slice(Math.max(0, items.length - maxItems));
}

function safeMaxItems(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function escapeUnknownText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

function addDiagnostic(
  diagnostics: Diagnostic[],
  code: string,
  severity: Diagnostic['severity'],
  line: number | undefined,
  message: string,
  detail?: { count?: number; limit?: number }
): void {
  appendDiagnostic(diagnostics, freezeObject({
    code,
    severity,
    ...(line === undefined ? {} : { line }),
    message,
    ...(detail === undefined ? {} : { detail: freezeObject(detail) })
  }));
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
