# Final release-candidate report

**Workflow:** `wf_0001`  
**Candidate:** `addorimprove.pi-session-preview@0.0.1`
**Date:** 2026-07-16  
**Scope:** frozen v1 only; no publish, push, pull request, or scope expansion.

## Release artifact and focused verification

The release candidate is `pi-session-preview.vsix`. The final local validation reran:

```text
npm run verify
npm run benchmark:large
code --extensions-dir <temporary-dir> --install-extension ./pi-session-preview.vsix --force
code --extensions-dir <temporary-dir> --list-extensions --show-versions
unzip -t pi-session-preview.vsix
```

The automated evidence proves the documented raw → preview → source same-group flow, option-priority **Open With…** fallback, external local-file refresh and malformed-tail recovery, bounded **Load Earlier/Newer** paging behavior, source-byte immutability, and VSIX install/archive integrity. Detailed command results and package inventory are recorded in [release-candidate-validation.md](release-candidate-validation.md); performance results are in [large-file-benchmark.md](large-file-benchmark.md).

## Requirement traceability

| Requirement | Implementation evidence | Test evidence |
|---|---|---|
| FR-1 read-only `CustomTextEditorProvider`; no Pi/edit path | `src/extension/provider.ts`, `src/extension/extension.ts`, `docs/pi-session-preview/SECURITY.md` | `src/test/vscode/suite/custom-editor.integration.test.ts` proves dirty-buffer preview and unchanged disk bytes; security/unit checks reject write/Pi/network paths. |
| FR-2 option-priority `*.jsonl`; no association mutation | `package.json` custom-editor contribution | `src/test/integration/manifest.integration.test.ts`; VS Code host fallback test. |
| FR-3 same-group title toggles and Open With fallback | `src/extension/commands.ts`, `package.json` editor-title menus | `src/test/unit/commands.test.ts`, `src/test/vscode/suite/open-with.test.ts`, and custom-editor host tests. |
| FR-4 v1–v3 parsing, source lines, active path | `src/core/parse.ts`, `src/core/normalize.ts`, `docs/pi-session-preview/SESSION-SCHEMA.md` | Parser/projection fixture, boundary, property, and Pi-export semantics tests. |
| FR-5 bounded supported cards and diagnostics | `src/core/normalize.ts`, `src/extension/protocol.ts`, `src/webview/main.ts` | Projection fixtures; hostile-cardinality, protocol, and renderer tests. |
| FR-6 recover around malformed input; controlled empty/error states | `src/core/parse.ts`, `src/extension/provider.ts` | Parser recovery suites and VS Code host malformed/unsupported-state tests. |
| FR-7 on-demand earlier/later paging | `src/extension/protocol.ts`, `src/webview/main.ts` | `src/test/unit/protocol.test.ts` and `src/test/unit/webview-renderer.test.ts` prove non-overlapping bounded pages and native paging controls. |
| FR-8 exact-URI debounced live refresh only | `src/extension/provider.ts` | VS Code host external append, rapid coalescing, split-panel, disposal, and 20 MiB tests. |
| Privacy, safety, accessibility, performance, compatibility | `SECURITY.md`, `ACCESSIBILITY.md`, `PERFORMANCE.md`, package metadata | CSP/hostile DOM/DTO tests, axe-core checks, benchmark, packaging audit, and VS Code 1.127.0 host run. |

## Pi HTML-export parity

The viewer independently adapts Pi’s persisted v1–v3 session and active-leaf semantics, ordered assistant/tool display, compaction, visible custom messages, branch summaries, and selected metadata. The observational parity harness validates the exporter’s `{header, entries, leafId}` shape and relevant path semantics; it does not reuse or execute exporter output.

Intentional divergences: latest path only (no tree/sidebar/search); narrow DOM-only Markdown; no syntax highlighter; inert/omitted URLs, images, base64 media, ANSI, custom-tool HTML, download/clipboard/share actions; compact metadata for hidden custom/state changes; 64-content-block, tool-argument, page, diagnostic, and file-size limits. See [PI-EXPORT-REFERENCE.md](../PI-EXPORT-REFERENCE.md) for the full matrix.

## Licensing and notices

The project is MIT licensed ([LICENSE](../../../LICENSE)). Pi coding agent is MIT licensed, but this candidate contains no copied Pi source/template/CSS/vendor/runtime or other nontrivial adapted portion. [THIRD-PARTY-NOTICES.md](../../../THIRD-PARTY-NOTICES.md) records that determination and the required process for any future adaptation. The VSIX has no production npm dependency tree.

## Marketplace and user documentation

`package.json` supplies publisher, repository, license, VS Code engine, category, keywords, and command/custom-editor contribution metadata. [README.md](../../../README.md) documents installation/use, return-to-source flow, privacy, compatibility, limitations, and development checks. [CHANGELOG.md](../../../CHANGELOG.md) records the 0.0.1 release-candidate scope.

## Cleanup audit

Retained: focused source/tests, synthetic fixtures, shared documentation, durable benchmark/release/final evidence, legal notices, and the single candidate VSIX. Removed: `node_modules`, compiled `dist`, generated webview bundle, VS Code test runtime/profile/logs/chat sessions/chat-edit state/credential-adjacent stores, subagent/worktree state, benchmarks, profiles, and other temporary build products. `.gitignore` and `.vscodeignore` prevent those artifacts from entering source control or the package; the VSIX contains only the allowlisted runtime/package files and legal/release documentation.

## Deferred features and residual risks

Deferred: branch selection/sidebar, search, syntax highlighting/full Markdown, media/images, rich custom-tool rendering, export/share/download/copy links, configurable settings, persisted UI state, future Pi formats, and non-local providers.

Residual release risk: automated tests cannot inspect native title-button pixels, real webview scroll geometry, DevTools console, forced-colors rendering, 200% zoom, or actual screen-reader speech. The reproducible manual desktop matrix remains in [PROGRESS.md](../PROGRESS.md). Remote SSH, WSL, Dev Containers, VS Code Web, Cursor, VSCodium, virtual/workspace providers, and non-`file:` URIs are unsupported and unverified. In-flight filesystem reads cannot be physically aborted, but tested revision supersession, cancellation, and disposal make late results inert.
