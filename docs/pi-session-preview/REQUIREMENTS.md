# Requirements

## Functional requirements
| ID | Requirement |
|---|---|
| FR-1 | The extension SHALL use `CustomTextEditorProvider` so a preview receives unsaved `TextDocument` contents; it SHALL never apply a `WorkspaceEdit`, save, format, or otherwise modify source, and SHALL expose no Pi execution path. |
| FR-2 | It SHALL contribute `piSessionPreview.preview` for `*.jsonl` at `priority: "option"`; it SHALL not alter `workbench.editorAssociations`. |
| FR-3 | A title action on a raw `.jsonl` SHALL open the preview with `vscode.openWith` in the current editor group. A scoped action in the preview SHALL reopen the default text editor in that group. Open With remains available. |
| FR-4 | It SHALL parse versions 1–3 according to [SESSION-SCHEMA.md](SESSION-SCHEMA.md), retain source line numbers, and render the inferred latest active path only. |
| FR-5 | It SHALL show a session summary, messages, assistant text/thinking, tool calls/results, compactions, visible custom messages, branch summaries, model changes, and diagnostics within configured bounds. Unsupported entries are summarized as metadata, never fatal. |
| FR-6 | It SHALL retain valid records around malformed lines and give a non-sensitive, line-numbered diagnostic. Missing/invalid headers and no renderable path SHALL produce an empty/error state, never a blank failed webview. |
| FR-7 | Transcript pages SHALL be loaded on demand; the user can load earlier/later path items without a session sidebar. |
| FR-8 | A file change MAY cause a debounced re-read/reparse of the same URI; UI state is reset safely when document identity/revision changes. No other file is read. |

## Non-functional requirements
- **Privacy:** zero network requests, telemetry, analytics, remote images, or third-party runtime CDN.
- **Safety:** CSP and DTO validation defined in [SECURITY.md](SECURITY.md); no `innerHTML` for session-derived data.
- **Accessibility:** conform to [ACCESSIBILITY.md](ACCESSIBILITY.md).
- **Performance:** limits and targets in [PERFORMANCE.md](PERFORMANCE.md).
- **Compatibility:** supported Pi disk formats are v1–v3 on desktop VS Code 1.127+ for local `file:` documents only. Remote SSH, WSL, Dev Containers, VS Code Web, Cursor, VSCodium, virtual/workspace providers, and other non-`file:` URIs are explicitly unsupported and unverified; they retain the source-editor escape hatch and show the controlled unreadable-file state.

## Explicit exclusions
The preview is not a Pi client, interactive conversation, session manager, editor, file explorer, cross-session search, theme picker, HTML exporter, or a faithful host for extension-defined renderers.

## Primary API sources
- Contribution schema: https://code.visualstudio.com/api/references/contribution-points#contributes.customEditors
- `vscode.openWith`: https://code.visualstudio.com/api/references/commands#vscode.openWith
- Menu `when` clauses: https://code.visualstudio.com/api/references/when-clause-contexts#activeCustomEditorId