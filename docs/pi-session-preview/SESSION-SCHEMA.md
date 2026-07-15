# Session schema and parsing contract

## Input model
A session is UTF-8 JSONL: one JSON object per physical line. The canonical first meaningful object is `type: "session"`; later objects are entries. Line numbers are 1-based physical lines and are retained in diagnostics.

### Supported versions
| Version | Accept | Normalize |
|---|---|---|
| v1 or absent header version | Yes | Generate deterministic synthetic IDs `v1:<physical-line>`; parent each accepted non-header entry to the preceding accepted entry. Convert `compaction.firstKeptEntryIndex` to the corresponding generated ID when valid. |
| v2 | Yes | Require/use stored `id`/`parentId`; preserve unknown fields. |
| v3 | Yes | Same as v2; normalize legacy message role `hookMessage` to `custom` only for display compatibility. |
| >3 | Best effort | Parse common known entries, emit `unsupported-version` diagnostic, never claim full compatibility. |

The parser never writes/migrates/reorders the source file. It accepts only a single session header; a late/duplicate header is diagnostic metadata, not a conversation entry.

## Validation and recovery rules
1. Decode as UTF-8 with replacement, split by physical LF; tolerate CRLF and a final empty line.
2. Enforce byte, line, record, nesting, string, image-metadata, and total-display limits before/while parsing ([PERFORMANCE.md](PERFORMANCE.md)).
3. Empty/whitespace-only lines are ignored and counted.
4. Invalid JSON, non-object JSON, oversized/deep records, missing entry type, duplicate IDs, and impossible field types produce a diagnostic and are skipped or represented as an opaque item; parsing continues.
5. For v2/v3, an entry with missing/invalid ID is not linked into the path. A missing parent makes it an orphan root and emits `missing-parent`; cycles and self-parenting are severed deterministically and diagnosed.
6. Unknown entry types become `unknown` normalized items with safe scalar metadata only. Unknown message roles/content blocks are similarly summarized.
7. No path can be inferred when no accepted entry exists: return an empty model plus diagnostics. An absent/bad header is a warning; a file is not rejected solely for it.

## Latest-active-branch inference (v1–v3)
For every supported version, Pi's loaded `SessionManager` indexes physical entries in read order and assigns its leaf to the last non-header entry; `pi --export` observed this behavior. We reproduce it **only as a viewer convention** after the version adapter has produced linkable IDs:
1. Take the last accepted, linkable non-header entry in physical order as the candidate leaf (including label/session-info/custom records, matching Pi).
2. Follow `parentId` to a root, stopping on a missing parent/cycle and retaining the valid prefix.
3. Reverse the collected IDs; this is `activePathIds`. Entries outside it are not rendered in v1 and do not trigger a tree UI.
4. If the candidate is unusable, use the last accepted root; emit `leaf-fallback`.

This is different from Pi's LLM `buildSessionContext()` compaction selection. The preview renders persisted path entries in their physical/path order; it does not synthesize an LLM context or hide old path records based on compaction.

## Relevant persisted shapes
```ts
type Header = { type: 'session'; version?: number; id?: string; timestamp?: string; cwd?: string; parentSession?: string };
type EntryBase = { type: string; id: string; parentId: string | null; timestamp?: string };
type Message = EntryBase & { type: 'message'; message: AgentMessage };
type AgentMessage =
 | { role: 'user'; content: string | Content[] }
 | { role: 'assistant'; content: AssistantContent[]; provider?: string; model?: string; usage?: Usage; stopReason?: string; errorMessage?: string }
 | { role: 'toolResult'; toolCallId?: string; toolName?: string; content?: Content[]; details?: unknown; isError?: boolean }
 | { role: 'bashExecution'; command?: string; output?: string; exitCode?: number; cancelled?: boolean }
 | { role: 'custom'; customType?: string; content?: string | Content[]; display?: boolean; details?: unknown };
type Content = { type: 'text'; text: string } | { type: 'image'; data?: string; mimeType?: string };
type AssistantContent = Content | { type: 'thinking'; thinking: string } | { type: 'toolCall'; id: string; name: string; arguments?: unknown };
```
Other known persisted entries are `model_change`, `thinking_level_change`, `compaction` (`summary`, `firstKeptEntryId`, `tokensBefore`), `branch_summary` (`summary`, `fromId`), `custom` (`customType`, `data`), `custom_message` (`customType`, `content`, `display`, `details`), `label` (`targetId`, `label`), and `session_info` (`name`). Exact upstream definitions: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts

## Normalized output invariants
- `sourceLine`, `sourceId` (or synthetic ID), `kind`, and `timestamp` are explicit.
- Display text is plain strings; no HTML, URLs, `details`, or image bytes cross the parser boundary as executable values.
- Tool result association is by matching `toolCallId` on the active path. Duplicate/missing/unmatched IDs are diagnostics and standalone safe metadata; never borrow a result from another branch.
- `custom_message` displays only when `display === true`; hidden custom data is counted but not shown. `custom` state is not rendered.
- Every truncated/omitted item carries a reason and original-size/count metadata.