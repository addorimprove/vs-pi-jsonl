# Research record

**Captured 2026-07-15.** This is evidence, not a dependency lock.

## VS Code primary sources
- [Custom editors guide](https://code.visualstudio.com/api/extension-guides/custom-editors): an alternate viewer belongs in a custom editor; lifecycle/recreation matters.
- [`CustomTextEditorProvider`](https://code.visualstudio.com/api/references/vscode-api#CustomTextEditorProvider): receives the authoritative `TextDocument`, including unsaved edits. Although it can synchronize edits in general, this viewer intentionally has no webview-to-document edit channel.
- [Custom-editor contribution](https://code.visualstudio.com/api/references/contribution-points#contributes.customEditors): `priority: "option"` presents Open With without overriding text editing.
- [Webview security/CSP](https://code.visualstudio.com/api/extension-guides/webview#security) and [message passing](https://code.visualstudio.com/api/extension-guides/webview#passing-messages-from-an-extension-to-the-webview): restrictive CSP, nonce, narrow local roots, and validated messages.
- [`editor/title` menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus), [`activeCustomEditorId`](https://code.visualstudio.com/api/references/when-clause-contexts#activeCustomEditorId), and [`vscode.openWith`](https://code.visualstudio.com/api/references/commands#vscode.openWith): support the two title actions and fallback picker.

## Pi evidence
- Installed executable: `pi` 0.80.6, package `@earendil-works/pi-coding-agent` (MIT).
- Installed format documentation: `.../docs/session-format.md`; it names v1 linear, v2 tree IDs, v3 `hookMessage`→`custom`.
- Installed exporter: `.../dist/core/export-html/{index.js,template.js,template.css,template.html,vendor/marked.min.js,vendor/highlight.min.js}`.
- Upstream `pi-mono` checkout consulted at `main` commit `84d134061f0e0f338e67028488bd1b78c8bc6d25` (package 0.65.0). It is useful source evidence but not version-identical to installed 0.80.6.
- Upstream format/source links: https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/session-manager.ts and https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent/src/core/export-html

## Local behavioral probes
`pi --export` was run against anonymized v3 and v1 fixtures in `/tmp` (not repository fixtures).
- CLI output embeds base64 JSON in `script#session-data`; CLI shape was `{ header, entries, leafId }` (no live system prompt/tools/custom renderer).
- All parsed entries, including branch alternatives, are embedded. `SessionManager._buildIndex()` chooses the **last non-header physical record** as `leafId`; the exporter displays the selected root-to-leaf path while tree data retains all entries.
- Exporting v1 migrated it to v3 and rewrote the input JSONL. Our viewer MUST NOT mutate input.
- Embedded data prevented a literal injected `<script>` from appearing in the output HTML. This is not a security model transferable to a VS Code webview.

## Implications
Use the native provider and a small own renderer. Do not load Pi or execute its export template. Preserve exporter-recognizable semantics where useful, but deliberately diverge for CSP, accessibility, VS Code theming, paging, and bundle size. Details: [PI-EXPORT-REFERENCE.md](PI-EXPORT-REFERENCE.md).