# Architecture decisions

| ID | Decision | Status | Rationale / consequence |
|---|---|---|---|
| ADR-001 | v1 is a read-only-use `CustomTextEditorProvider`, not an editable custom-document provider. | Accepted (revised) | It is the supported VS Code provider that receives unsaved `TextDocument` buffers. The preview never emits a `WorkspaceEdit`, save, revert, backup, or source synchronization action. |
| ADR-002 | Custom editor priority is `option`; no association writes. | Accepted | Raw JSONL remains default, Open With is available, and user choice is respected. |
| ADR-003 | Use two scoped `editor/title` commands: raw→preview and preview→source in same group. | Accepted | Primary UX is discoverable and reversible; Open With remains fallback. |
| ADR-004 | Parse Pi formats 1–3 locally and never import/start Pi. | Accepted | Viewer works without Pi and has no runtime/execution trust escalation. |
| ADR-005 | Infer active branch as last accepted physical non-header entry then ancestors. | Accepted | Matches observed Pi `SessionManager` index/`pi --export` behavior; document as a viewer convention. |
| ADR-006 | Preserve partial results and diagnostics on malformed input; never rewrite/migrate input. | Accepted | Pi may migrate on load/export; read-only preview must not. |
| ADR-007 | Complete tree is parsed but only latest active path is rendered; no sidebar/browser in v1. | Accepted | Frozen scope/paging/performance. Branch selection is deferred. |
| ADR-008 | Use bounded extension-side paging and no `retainContextWhenHidden`. | Accepted | Limits memory/DOM and makes recreation safe. |
| ADR-009 | Small DOM-only Markdown renderer for display strings; raw HTML is literal text, links/images/command URIs are never activated, and base64 media/custom-tool HTML remain forbidden. | Accepted (revised for renderer step) | Preserves readable persisted Markdown/code while retaining the CSP/XSS/privacy boundary. |
| ADR-010 | Pi exporter is reference-only; do not vendor/import template, marked, highlight.js, or ANSI renderer. | Accepted | Standalone exporter conflicts with CSP, theme/accessibility, paging and package-size goals. |
| ADR-011 | Any future copied Pi MIT portion needs provenance and MIT notice. | Accepted | Respect license while avoiding blind reuse. |
| ADR-012 | No telemetry or network capability in v1. | Accepted | Sessions are sensitive and offline viewing is core. |
| ADR-013 | Support only local `file:` documents in desktop VS Code; reject remote/virtual URI schemes. | Accepted | The preview's bounded stat/read and exact-file watcher lifecycle are intentionally local-only. Remote SSH, WSL, Dev Containers, VS Code Web, Cursor, VSCodium, and virtual providers have no support or compatibility claim; they receive a controlled read-failed state while source remains available. |

## Deferred decisions
- User-selectable branch history/tree navigation and full-text search.
- Syntax highlighting and broader CommonMark extensions. The renderer intentionally supports only safe headings, lists, quotes, emphasis, inline code, and fenced code.
- Image/media presentation, export/share/copy links, tool-specific rich rendering.
- Configurable limits/settings, saved presentation state, multi-editor synchronization.
- Future Pi format versions and a user-controlled preferred association.

Deferred work must not weaken v1 non-goals without updating charter, security, accessibility, performance, tests, and parity review.