# Workflow `wf_0001` — release-candidate validation
**Status: complete.**

### Finalization (2026-07-16)
- [x] Finalized README/use/privacy/limitations, Marketplace metadata, architecture/evidence links, changelog, MIT/third-party notice, and [final-report.md](evidence/final-report.md); no v1 scope was widened.
- [x] Reran `npm run verify` (54 unit, 2 manifest, 6 VS Code 1.127.0 Extension Development Host, package, and production-audit checks), `npm run benchmark:large`, and fresh CLI VSIX install/archive-integrity smoke. The candidate is 36,088 bytes with 19 allowlisted entries, including release/legal documentation and no source/tests/fixtures/dependencies.
- [x] Removed generated test profile/session/workflow/auth state, build outputs, dependency tree, benchmark/sandbox/subagent state, and other ignored leftovers; only the release-candidate VSIX remains as a generated delivery artifact.

### Release-candidate validation (2026-07-15)
- [x] Adversarial review found and fixed two bounded-work blockers: a 512 KiB content array could previously create an unbounded nested DOM, and tool argument serialization staged attacker-sized token arrays. Parsed entries and rendered cards now retain at most 64 blocks (with one counted `content-block-limit` notice); tool argument serialization has a 1,024-node traversal budget and 16,000-character display cap. Webview DTO validation rejects more than 64 nested blocks, and renderer card heading IDs are per-render ordinals rather than hashes of content-derived keys.
- [x] Added the 50,000-block/50,000-argument hostile regression plus oversized-host-DTO renderer regression. The parser/projection/DTO/DOM contract is bounded and the source input remains immutable.
- [x] Documented the intentional Pi-export divergence, package/MIT audit, and compatibility boundary: only local `file:` documents in desktop VS Code 1.127+ are supported. Remote SSH, WSL, Dev Containers, VS Code Web, Cursor, VSCodium, and virtual/workspace URI providers are unsupported and unverified; they receive the existing controlled read-failed state with source still available.
- [x] Clean validation ran `rm -rf node_modules dist media/main.js pi-session-preview.vsix && npm ci`, then `npm audit --audit-level=high`, `npm run verify`, and `npm run benchmark:large`: 54 unit, 2 manifest, and 6 real VS Code 1.127.0 darwin-arm64 Extension Development Host tests passed; lint/typecheck, production and full dependency audits (0 vulnerabilities), package test, and 20 MiB host/page gate passed. The current VSIX has 17 files and is 33,045 bytes; a clean temporary `code --extensions-dir … --install-extension ./pi-session-preview.vsix --force` smoke install and `unzip -t` passed. See [evidence/release-candidate-validation.md](evidence/release-candidate-validation.md).

### Completed
- [x] Raised the bounded local-file admission limit to 20 MiB, while preserving an explicit file-stat preflight limit state for known larger files and a post-read race check before parsing. Dirty documents now count UTF-8 bytes before allocating an encoded duplicate, so an over-limit dirty buffer is not copied into extension-host memory.
- [x] Replaced whole-buffer decoded-string splitting and per-line re-encoding with direct bounded byte framing. Parser recovery, BOM/CRLF, line/entry limits, physical diagnostic ordering, v1 compaction indexing, malformed UTF-8, and source immutability remain covered by the existing suite.
- [x] Capped parser/projection/webview diagnostics at 100 and collapse excess notices into counted `diagnostic-limit`; the host DTO validator and renderer reject/defensively slice diagnostic floods.
- [x] Added deterministic temporary 1 MiB, 5 MiB, 20 MiB, and 50 MiB many-turn generators, a >512 KiB single-line tool-output recovery probe, repeated-refresh heap/DOM profiling, and the durable report [evidence/large-file-benchmark.md](evidence/large-file-benchmark.md). The generator removes its OS-temporary fixtures in `finally`; `.gitignore` excludes benchmark JSONL and profiling artifacts, while `.vscodeignore` packages no tests/scripts/fixtures.
- [x] Benchmarked Node v24.14.0 on darwin-arm64: 20 MiB/10,000-entry parse+normalize p95 was 79.7 ms, first useful 50-card render p95 was 7.3 ms, and the DOM was 365 nodes. Ten 5 MiB/10,000-entry refreshes held 365 DOM nodes and post-GC heap stabilized around 46.6 MiB. The real VS Code 1.127.0 host also opened the 20 MiB/10,000-entry shape, posted a 50-item page, and met its <2,000 ms provider-to-webview assertion (the encompassing host test completed in 911 ms in final verification). The 50 MiB fixture exceeded the 20 MiB provider preflight and reached the explicit byte-limit path; no full rendering was attempted.

### Verification performed
- `npm run benchmark:large` — passed; regenerated only `docs/pi-session-preview/evidence/large-file-benchmark.md` and removed all generated fixtures.
- `npm test` — passed: 53 unit tests, including diagnostic flood, concurrent diagnostic-bucket accounting, trailing-newline physical-limit, and huge single-line recovery coverage.
- `npm run integration-test:vscode` — passed: 6 Extension Development Host tests on cached VS Code 1.127.0 darwin-arm64, including the 20 MiB/10,000-entry bounded-page assertion.
- `npm run verify` — passed: lint, strict typecheck, 53 unit tests, 2 manifest tests, 6 VS Code 1.127.0 Extension Development Host tests, VSIX contents/size (17 files, 31.63 KB), and production audit (0 vulnerabilities).

### Prior completed — custom-editor integration tests
- [x] Extended the VS Code 1.127.0 Extension Development Host suite to open the real `CustomTextEditorProvider`, invoke both production title commands, and use the built-in `vscode.openWith` fallback in the original editor group.
- [x] Added development/test-mode-only, in-memory provider-post observation. It has no command, webview protocol addition, production activation export, logging, file access, or source-write behavior; it lets the real host test assert the exact bounded `init` state delivered to each live panel.
- [x] Added real-host coverage for provider/command registration, raw → preview → raw same-group transitions, option-priority Open With fallback, dirty-buffer parsing, byte-for-byte on-disk source immutability, external append refresh, malformed trailing JSON recovery, unsupported JSONL controlled state, rapid revision coalescing, split panels, and disposed-panel isolation.
- [x] Corrected the test's malformed-tail expectation to the parser's stable `invalid-json` diagnostic. No production integration defect was found or changed.

### Verification performed
- `npm run integration-test:vscode` — passed against cached VS Code **1.127.0** (`darwin-arm64`): **5** Extension Development Host tests. The suite creates unique workspace files, uses the actual `workspace.fs` external writes and actual webviews, and closes/deletes every temporary tab/file.
- `npm run typecheck` — passed.
- `npm run lint` — passed.

### Automated evidence
- The development-host probe records only a message already being posted to an actual webview and only in `ExtensionMode.Development`/`Test`; normal activation returns no probe. Tests prove each relevant panel received: valid content, unsaved content rather than disk content, externally appended content, recovered malformed-tail diagnostics, or the explicit `unsupported-format` empty state.
- Before/after `workspace.fs.readFile` assertions prove that opening, dirty previewing, refreshing, malformed recovery, and rapid changes never rewrite the source bytes.
- Three writes 40 ms apart produce only the final sentinel after the provider's 250 ms debounce; after closing one split, only the surviving panel can publish the final revision.
- The Extension Development Host run completed all cases without uncaught extension-host failures. The separately exercised webview bundle/protocol DOM tests remain the regression gate for malformed host DTOs and renderer exceptions.

### Reproducible manual desktop evidence (not introspectable through the public headless VS Code API)
Run `npm run integration-test:vscode`, then launch the extension in an Extension Development Host with `src/test/fixtures/vscode/session.jsonl` open. On VS Code 1.127.0:
1. Open the raw `.jsonl`. Confirm **Open Pi Session Preview** is visible in the editor title; activate it. Confirm **Open JSONL Source** replaces it in the same title area and editor group. Use **Reopen Editor With… → Pi Session Preview**, then return with **Open JSONL Source**.
2. Append a valid JSONL entry from another editor/process while preview is open. Confirm the new card appears; append `{"type":` without a final newline and confirm a warning appears while prior cards remain. Confirm the Developer Tools Console has no uncaught error.
3. Split the preview, close one split, append another entry, and confirm the survivor refreshes without a dead panel/error. Scroll the survivor away from the bottom before one append and at the bottom before another to confirm reader-position preservation and near-bottom-only follow behavior.
4. Repeat with a non-Pi JSONL file and confirm the explicit controlled unsupported-format state; verify the raw source bytes with `shasum -a 256 file.jsonl` before/after each preview action.
5. Repeat title toggles, diagnostic announcements, 200% zoom, keyboard-only use, dark/light/high-contrast themes, and a screen reader. Record VS Code version/OS/theme, console result, and before/after hashes in release evidence.

### Residual limitations
- The public `@vscode/test-electron` API cannot inspect native editor-title button pixels/visibility, screen-reader output, Developer Tools console, or real webview scroll geometry. The manual protocol above remains the release evidence for those UI-only behaviors.
- Remote SSH, WSL, Dev Containers, VS Code Web, Cursor, VSCodium, virtual/workspace providers, and non-`file:` URIs are intentionally unsupported and were not tested; no compatibility claim is made for them.
- Filesystem reads already in progress cannot be physically aborted by VS Code APIs; the tested request IDs, debounce, cancellation, and disposal make late completion inert.
