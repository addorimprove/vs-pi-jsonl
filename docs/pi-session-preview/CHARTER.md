# Pi Session Preview — v1 charter

## Mission
Provide an **optional, read-only VS Code preview** for a Pi session JSONL file. It helps a developer inspect an existing local transcript without starting Pi, changing the file, or sending data anywhere.

## Frozen v1 scope
- A read-only-use `CustomTextEditorProvider` for `*.jsonl`, contributed with `priority: "option"`, so unsaved source buffers can be previewed without ever editing them from the webview.
- Native editor-title toggle UX:
  1. On a normal `.jsonl` text editor, a preview icon invokes `vscode.openWith` and opens **Pi Session Preview in the same editor group**.
  2. In Pi Session Preview, a source-code icon reopens the normal text editor in that group.
  3. **Open With... / Reopen Editor With...** remains the fallback.
- Parse Pi session formats v1, v2, and v3; show the latest active branch inferred from file order; render a bounded, paged, accessible transcript and nonfatal diagnostics.
- Watch/reload only the currently opened local file while its preview is alive.

## Non-goals (v1)
No chat input; Pi runtime or extension execution; sidebar/session browser; file editing/save/formatting; file links/opening; telemetry/analytics; network access; remote resource loading; workspace scanning; custom-tool HTML execution; sharing/export/download; persistent editor association changes.

## Product principles
1. Raw JSONL remains authoritative and immediately recoverable.
2. Every visible string is untrusted data, never executable markup.
3. Degrade locally: show valid records and explain bad records.
4. Prefer VS Code theme/accessibility primitives over a standalone web app.
5. Pi HTML export is a behavioral/design reference, not a runtime dependency.

## Sources
- VS Code custom editors: https://code.visualstudio.com/api/extension-guides/custom-editors
- VS Code API `CustomTextEditorProvider`: https://code.visualstudio.com/api/references/vscode-api#CustomTextEditorProvider
- Pi session format from the locally installed Pi 0.80.6 documentation (`docs/session-format.md`)

See [REQUIREMENTS.md](REQUIREMENTS.md) and [DECISIONS.md](DECISIONS.md).