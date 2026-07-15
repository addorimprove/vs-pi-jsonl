# Stable interfaces (v1)

All contracts are JSON-serializable, discriminated by `protocol: 1`, and reject unknown fields/actions at runtime. Types below are the compatibility boundary; implementations may add internal fields only behind adapters.

## Parser contract
```ts
export type Severity = 'info' | 'warning' | 'error';
export interface Diagnostic { code: string; severity: Severity; line?: number; message: string; detail?: { count?: number; limit?: number }; }
export interface ParseLimits { maxBytes: number; maxLines: number; maxRecordBytes: number; maxDepth: number; maxStringChars: number; maxItems: number; }
export interface ParseInput { bytes: Uint8Array; uriLabel: string; limits: ParseLimits; }
export interface ParseResult { model: NormalizedSessionModel; diagnostics: Diagnostic[]; source: { bytesRead: number; linesSeen: number; version: 1|2|3|'unknown'; truncated: boolean }; }
export function parsePiSession(input: ParseInput): ParseResult;
```
`parsePiSession` is deterministic, side-effect-free, never throws for document content, and returns a valid empty model on failure. I/O, URI access, timestamps, and webview paging are outside it.

## Normalized view model
```ts
export type ItemKind = 'user'|'assistant'|'tool'|'bash'|'compaction'|'branchSummary'|'customMessage'|'modelChange'|'thinkingChange'|'label'|'sessionInfo'|'unknown';
export interface TextBlock { kind: 'text'|'thinking'|'code'; text: string; truncated?: boolean; }
export interface ToolBlock { callId?: string; name: string; argumentsText?: string; resultText?: string; isError?: boolean; unmatchedResult?: boolean; truncated?: boolean; }
export interface ViewItem {
  key: string; sourceId: string; sourceLine: number; kind: ItemKind; timestamp?: string;
  title?: string; blocks?: TextBlock[]; tool?: ToolBlock; metadata?: Record<string, string|number|boolean>;
  omitted?: { reason: string; originalSize?: number };
}
export interface SessionSummary { sessionId?: string; version: 1|2|3|'unknown'; name?: string; cwd?: string; activeLeafId?: string; pathItemCount: number; hiddenCustomCount: number; }
export interface NormalizedSessionModel { summary: SessionSummary; activePathIds: string[]; items: ViewItem[]; }
```
Invariants: keys are unique/stable for one parse revision; all displayed values are plain text/scalars; `items` contains only latest active-path items; each parsed entry and rendered item has at most 64 blocks (overflow is one counted omission notice); `details`, raw image bytes, arbitrary objects, and HTML do not cross this interface.

## Extension ↔ webview protocol
```ts
export type ExtensionToWebview =
 | { protocol: 1; type: 'init'; revision: number; summary: SessionSummary; diagnostics: Diagnostic[]; page: Page; limits: PublicLimits }
 | { protocol: 1; type: 'page'; revision: number; page: Page }
 | { protocol: 1; type: 'error'; revision: number; message: string };
export type WebviewToExtension =
 | { protocol: 1; type: 'ready' }
 | { protocol: 1; type: 'requestPage'; revision: number; direction: 'older'|'newer'; anchor: number }
 | { protocol: 1; type: 'announce'; revision: number; message: string };
export interface Page { start: number; total: number; items: ViewItem[]; hasOlder: boolean; hasNewer: boolean; }
export interface PublicLimits { pageItems: number; maxRenderedItems: number; textCharsPerBlock: number; maxDiagnostics: number; }
```
Paging is zero-based and half-open: `Page.start` is the index of its first item, `Page.items` is exactly `model.items.slice(start, min(total, start + pageItems))`, and `total` is `model.items.length`. The initial newest page begins at `floor((total - 1) / pageItems) * pageItems` (or `0` for an empty model), so it may be a final partial page and all adjacent pages partition the transcript. `requestPage.anchor` MUST equal the currently displayed `Page.start`. For `older`, extension returns `start = max(0, anchor - pageItems)`; for `newer`, it returns `start = anchor + pageItems` only when the current page has `hasNewer`; at either boundary it returns the current page unchanged. Thus adjacent pages neither duplicate nor skip indexes. `hasOlder = start > 0`; `hasNewer = start + items.length < total`.

Rules: extension messages are one-way snapshots; every page request must match current `revision`, have a safe integer anchor/direction, and resolve to bounded indexes. Diagnostics are capped at `maxDiagnostics` (100 in v1), and a single `diagnostic-limit` warning counts notices omitted from malformed input. Nested `ViewItem.blocks` are capped at 64 and the webview rejects an oversized host DTO before rendering. Webview `announce` is optional accessibility text only and never a command. Unknown/malformed/stale messages are ignored and logged only in development.

## Command constants
```ts
const VIEW_TYPE = 'piSessionPreview.preview';
const OPEN_PREVIEW = 'piSessionPreview.openPreview';
const OPEN_SOURCE = 'piSessionPreview.openSource';
```
These names are provisional until the extension publisher/manifest is established; once released they are semver-stable. No webview message may open a URI or execute a command.

## Error vocabulary
`invalid-json`, `non-object-record`, `missing-header`, `duplicate-header`, `unsupported-format`, `unsupported-version`, `invalid-id`, `duplicate-id`, `missing-parent`, `cycle`, `leaf-fallback`, `record-limit`, `byte-limit`, `depth-limit`, `string-truncated`, `content-block-limit`, `unsupported-entry`, `unmatched-tool-result`, `media-omitted`, `diagnostic-limit`, `read-failed`.

See [SESSION-SCHEMA.md](SESSION-SCHEMA.md) and [SECURITY.md](SECURITY.md).