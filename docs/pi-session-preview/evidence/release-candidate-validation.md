# Release-candidate validation evidence

Date: 2026-07-15 (local darwin-arm64 environment)

## Adversarial findings fixed

1. A permitted JSONL content array could yield an unbounded number of nested card blocks and DOM nodes. The parser now retains at most 64 blocks and replaces excess blocks with one counted `content-block-limit` omission. Projection and webview validation/rendering enforce the same bound.
2. Tool-argument display serialization previously allocated one token per array/object member before applying its text cap. It now walks directly with a 1,024-node budget and a 16,000-character cap.
3. Content-derived 32-bit card-heading IDs could collide. The renderer now uses unique per-page ordinal IDs.
4. Remote URI support was ambiguous. The product now explicitly supports only local `file:` documents in desktop VS Code 1.127+; Remote SSH and other non-file providers are intentionally unsupported and show the controlled read-failed state.

Regression coverage includes 50,000 content blocks, 50,000 tool-argument members, and a malformed host DTO with 65 blocks.

## Clean-install automated gate

Executed after removing `node_modules`, `dist`, `media/main.js`, and the prior VSIX:

```text
npm ci
npm audit --audit-level=high
npm run verify
npm run benchmark:large
```

Results:

- `npm ci`: 498 packages installed.
- Full and production-only `npm audit --audit-level=high`: 0 vulnerabilities. The lockfile pins safe override resolutions for `diff` 8.0.4 and `serialize-javascript` 7.0.7 used transitively by dev-only Mocha.
- Lint and strict typecheck: passed.
- Unit suite: 54 passed.
- Manifest integration suite: 2 passed.
- VS Code Extension Development Host: 6 passed on cached VS Code 1.127.0, darwin-arm64. This includes same-group raw/preview/source fallback, source-byte immutability, dirty buffers, external updates, malformed recovery, revision/disposal lifecycle, and 20 MiB/10,000-entry bounded-page initialization (681 ms for that case, below 2 s).
- Webview security/accessibility tests: passed as part of unit suite, including hostile content, CSP/static-asset rules, DOM sink assertions, malformed DTO rejection, semantic controls, and axe-core zero serious/critical findings.
- Large benchmark: passed. Final measured 20 MiB parse+normalize p95 99.9 ms, first useful render p95 7.6 ms, 50 cards/365 DOM nodes; see [large-file-benchmark.md](large-file-benchmark.md).
- VSIX package test: passed. `pi-session-preview.vsix` contains exactly 19 runtime/package files and is 36,088 bytes (under the 2 MiB cap), including README, CHANGELOG, and THIRD-PARTY-NOTICES alongside the allowlisted runtime.

## VSIX smoke

A fresh temporary extensions directory was used:

```text
code --extensions-dir <temporary-dir> --install-extension ./pi-session-preview.vsix --force
code --extensions-dir <temporary-dir> --list-extensions --show-versions
unzip -t pi-session-preview.vsix
```

The CLI installed `rajan.pi-session-preview@0.0.1`; archive integrity passed. The final repeat installed the 36,088-byte/19-entry VSIX into a fresh temporary extensions directory, confirmed the exact extension ID/version, and deleted the temporary directory afterward.

## Attribution and support audit

No Pi runtime, exporter template, vendor JavaScript, CSS, or copied nontrivial Pi implementation is packaged or imported. The viewer independently implements documented persisted-format/export semantics; its MIT provenance rule remains in [PI-EXPORT-REFERENCE.md](../PI-EXPORT-REFERENCE.md). The release VSIX has no production dependency tree (`npm ls --omit=dev --all` is empty).

Manual-only Desktop VS Code checks (native title buttons, DevTools console, actual screen-reader output, forced colors, zoom, and scroll geometry) remain documented in [PROGRESS.md](../PROGRESS.md). No claim is made for VS Code Web, Cursor, VSCodium, or remote/virtual providers.
