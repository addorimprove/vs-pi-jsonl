# Architecture

## Components and ownership
1. **Extension host — registration/commands.** Manifest declares option-priority custom editor and two editor-title commands. `PreviewController` invokes `vscode.openWith(uri, viewType, { viewColumn: active.viewColumn, preserveFocus: false })`; source command opens the default text editor in the active group. It never changes associations.
2. **Read-only text-document provider.** `PiSessionPreviewProvider implements CustomTextEditorProvider`. `resolveCustomTextEditor` receives VS Code's `TextDocument`, reads its in-memory text when dirty (so unsaved source changes are visible), otherwise reads only that local URI, calls parser/normalizer, wires validated messages plus exact-URI text-document/file listeners, and disposes all listeners. It never applies an edit or synchronizes a webview change back to the document.
3. **Parser core (pure TypeScript).** Bounded decode → JSONL framing → version adapter → graph validator → latest-path inference → normalized model/diagnostics. It has no VS Code, DOM, fs, or Pi imports.
4. **Extension-side paging adapter.** Owns the full bounded normalized model per panel and sends only summary + a requested page. It is the authority for page indexes/limits and rejects stale revision requests.
5. **Webview shell.** Extension-owned static JS/CSS loaded via `asWebviewUri`, CSP nonce, and VS Code CSS variables. A DOM renderer uses `textContent`, semantic cards, disclosure controls, and a single request-page action. It has no filesystem/network/Pi imports.

## Data flow
`URI → bounded read → ParseResult → NormalizedSessionModel → init DTO → page DTOs → DOM`.

On exact-URI text-document or watcher event, debounce, cancel/supersede old reads, increment `revision`, parse again, and send a new `init` after webview readiness. A hidden webview is recreated from the model; `retainContextWhenHidden` stays false. The webview persists only numeric page/scroll state, never session content, in VS Code webview state.

## Editor integration
- `customEditors`: `viewType: "piSessionPreview.preview"`, selector `*.jsonl`, `priority: "option"`.
- Raw title action is visible only for `.jsonl` text editors and runs `piSessionPreview.openPreview`, which calls `vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, { viewColumn: active.viewColumn, preserveFocus: false })`.
- Preview title action uses `activeCustomEditorId == piSessionPreview.preview` and runs `piSessionPreview.openSource`, which calls `vscode.commands.executeCommand('vscode.openWith', uri, 'default', { viewColumn: panel.viewColumn, preserveFocus: false })`. `default` is VS Code's built-in text-editor target for this command.
- Release integration test against the declared `engines.vscode` range (baseline observed: 1.127.0) MUST assert both transitions retain `viewColumn` and that **Open With...** still lists the option-priority preview. No global association is a fallback mechanism.

## Module boundaries
| Module | May depend on | Must not depend on |
|---|---|---|
| `core/schema`, `core/parse`, `core/normalize` | TypeScript standard library | vscode, DOM, node fs, Pi |
| `extension/document`, `extension/provider`, `extension/commands` | vscode + core + node fs | webview DOM, Pi runtime |
| `protocol` | shared TS types | vscode, DOM, node fs |
| `webview/main`, `webview/render`, `webview/styles` | protocol + browser DOM | node/vscode/Pi, arbitrary HTML |
| `test/fixtures` | core test helpers | production extension state |

## Deliberate non-architecture
No Pi package import; no HTML-export iframe; no extension-defined tool renderer; no server/worker; no session index; no shared persistent store. The preview remains useful if Pi is uninstalled.

See [INTERFACES.md](INTERFACES.md), [SECURITY.md](SECURITY.md), and [PERFORMANCE.md](PERFORMANCE.md).