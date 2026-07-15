/** Pure, Pi-runtime-free contracts for the JSONL parse/normalization stage. */

export type Severity = 'info' | 'warning' | 'error';
export type SessionVersion = 1 | 2 | 3 | 'unknown';
export type SafeScalar = string | number | boolean | null;

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly line?: number;
  readonly message: string;
  readonly detail?: Readonly<{ count?: number; limit?: number }>;
}

export interface ParseLimits {
  readonly maxBytes: number;
  readonly maxLines: number;
  readonly maxRecordBytes: number;
  readonly maxDepth: number;
  readonly maxStringChars: number;
  readonly maxItems: number;
}

export interface ParseInput {
  readonly bytes: Uint8Array;
  readonly uriLabel: string;
  readonly limits: ParseLimits;
}

export interface TextBlock {
  readonly kind: 'text' | 'thinking' | 'code';
  readonly text: string;
  readonly truncated?: boolean;
}

export interface ToolBlock {
  readonly callId?: string;
  readonly name: string;
  readonly argumentsText?: string;
  readonly resultText?: string;
  readonly isError?: boolean;
  readonly unmatchedResult?: boolean;
  readonly truncated?: boolean;
}

export type ItemKind =
  | 'user'
  | 'assistant'
  | 'tool'
  | 'bash'
  | 'compaction'
  | 'branchSummary'
  | 'customMessage'
  | 'modelChange'
  | 'thinkingChange'
  | 'label'
  | 'sessionInfo'
  | 'unknown';

export interface ViewItem {
  readonly key: string;
  readonly sourceId: string;
  readonly sourceLine: number;
  readonly kind: ItemKind;
  readonly timestamp?: string;
  readonly title?: string;
  readonly blocks?: readonly TextBlock[];
  readonly tool?: ToolBlock;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly omitted?: Readonly<{ reason: string; originalSize?: number }>;
}

export interface SessionSummary {
  readonly sessionId?: string;
  readonly version: SessionVersion;
  readonly name?: string;
  readonly cwd?: string;
  readonly activeLeafId?: string;
  readonly pathItemCount: number;
  readonly hiddenCustomCount: number;
}

/** The frozen public projection shape produced from safe parsed records. */
export interface NormalizedSessionModel {
  readonly summary: SessionSummary;
  readonly activePathIds: readonly string[];
  readonly items: readonly ViewItem[];
}

export type ParsedContentKind = 'text' | 'thinking' | 'toolCall' | 'media' | 'unknown';

export interface ParsedContent {
  readonly kind: ParsedContentKind;
  readonly text?: string;
  readonly callId?: string;
  readonly name?: string;
  readonly argumentsText?: string;
  readonly metadata?: Readonly<Record<string, SafeScalar>>;
  readonly truncated?: boolean;
  readonly omitted?: Readonly<{ reason: string; originalSize?: number }>;
}

/** A safe, flat record handoff for the later graph/projection layer. */
export interface NormalizedEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly parentIdWasInvalid?: boolean;
  readonly sourceLine: number;
  readonly type: string;
  readonly kind: ItemKind;
  readonly timestamp?: string;
  readonly role?: string;
  readonly content: readonly ParsedContent[];
  readonly fields: Readonly<Record<string, SafeScalar>>;
  readonly hidden?: boolean;
  readonly omitted?: Readonly<{ reason: string; originalSize?: number }>;
}

export interface ParsedHeader {
  readonly sourceLine: number;
  readonly version: SessionVersion;
  readonly declaredVersion?: number;
  readonly sessionId?: string;
  readonly timestamp?: string;
  readonly cwd?: string;
  readonly fields: Readonly<Record<string, SafeScalar>>;
}

export interface ParseSource {
  readonly bytesRead: number;
  readonly linesSeen: number;
  readonly version: SessionVersion;
  readonly truncated: boolean;
}

/** Maximum diagnostics allowed across parser/projection and the webview boundary. */
export const MAX_DIAGNOSTICS = 100;

/** Maximum safe content blocks retained from one parsed entry and rendered card. */
export const MAX_CONTENT_BLOCKS = 64;

/**
 * Keeps malformed input from turning diagnostics into an unbounded second data
 * stream. The final slot becomes a deterministic omitted-count notice.
 */
export function appendDiagnostic(diagnostics: Diagnostic[], diagnostic: Diagnostic): void {
  if (diagnostics.length < MAX_DIAGNOSTICS) {
    diagnostics.push(diagnostic);
    return;
  }
  const index = MAX_DIAGNOSTICS - 1;
  const previous = diagnostics[index];
  const previousOmitted = previous?.code === 'diagnostic-limit' ? (previous.detail?.count ?? 0) : 1;
  // A collapsed bucket can be merged into another bounded bucket; retain the
  // count it already represents instead of treating its summary as one item.
  const incomingOmitted = diagnostic.code === 'diagnostic-limit' ? (diagnostic.detail?.count ?? 0) : 1;
  const omitted = previousOmitted + incomingOmitted;
  diagnostics[index] = Object.freeze({
    code: 'diagnostic-limit',
    severity: 'warning',
    message: 'Additional diagnostics were omitted by the preview limit.',
    detail: Object.freeze({ count: omitted, limit: MAX_DIAGNOSTICS })
  });
}

export interface ParseResult {
  readonly model: NormalizedSessionModel;
  readonly diagnostics: readonly Diagnostic[];
  readonly source: ParseSource;
  /** Safe parsed records in physical accepted-entry order, retained for diagnostics/tests. */
  readonly records: readonly NormalizedEntry[];
  readonly header?: ParsedHeader;
}

export const DEFAULT_PARSE_LIMITS: Readonly<ParseLimits> = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxLines: 50_000,
  maxRecordBytes: 512 * 1024,
  maxDepth: 64,
  maxStringChars: 32_000,
  maxItems: 10_000
});
