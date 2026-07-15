# Test strategy and release gates

## Fixture catalog
All fixtures are synthetic/anonymized, committed as JSONL plus expected normalized JSON/snapshots where useful.

| Fixture | Purpose |
|---|---|
| `v1-linear`, `v1-compaction-index` | Generated IDs, parents, v1→view normalization without source rewrite. |
| `v2-tree-active-last`, `v3-tree-active-last` | Branch inference: physical last accepted entry, including a final label, selects Pi-compatible active path; nonactive branch excluded. |
| `all-known-entries` | user/assistant/text/thinking/calls/results/bash/compaction/branch/custom/custom_message/model/thinking/label/session-info. |
| `tool-pairing` | Multiple calls/results, result error/diff, duplicate/missing/unmatched IDs, cross-branch isolation. |
| `custom-visibility`, `compaction` | `display` semantics, opaque custom state, compaction persisted display. |
| `malformed-mixed` | bad JSON, blank line, array/scalar line, duplicate IDs, bad parent/cycle/header/version; valid neighbors survive. |
| `hostile-content` | HTML, SVG, event attributes, JavaScript/control-obfuscated URLs, Markdown payloads, unusual Unicode/ANSI, large/deep values. |
| `limits-large` | each resource cap, paging, cancellation/reload; deterministic 1 MiB, 5 MiB, 20 MiB, and 50 MiB many-turn fixtures plus a >512 KiB single-line tool-output probe are generated in an OS temp directory by `npm run benchmark:large`, never source-controlled. |
| `hostile-cardinality` | 50,000 empty content blocks and 50,000 tool-argument members prove parser/projection/host-DTO bounds: at most 64 retained blocks, one counted omission, and tool serialization stops after a 1,024-node budget. |
| `pi-export-reference-v1/v3` | Input and decoded `pi --export` reference facts (complete entries, CLI shape, leaf) captured for installed Pi version/date. |

Fixtures contain no real paths, credentials, images, prompts, proprietary source, or session IDs. Regenerate exporter fixtures with `PI_SKIP_VERSION_CHECK=1 PI_TELEMETRY=0` and record Pi version/hash/date.

## Test layers
| Layer | Required checks | Acceptance threshold |
|---|---|---|
| Unit | line framing, v1/v2/v3 adapters, graph/cycle/leaf rules, compaction/custom/tool normalization, limits, deterministic DTO serialization | 100% branches for parser recovery/leaf/limit code; all fixture expectations pass. |
| Property/fuzz | random JSONL, malformed UTF-8/JSON, cyclic parent graphs, extreme strings/nesting | 10,000 seeded cases, no uncaught exception/hang; seed retained on failure. |
| Security | DTO schema rejects malformed/stale messages; hostile corpus DOM assertions; CSP parser; no write/Pi/network APIs | zero executable nodes/handlers/data-derived URLs; zero High/Critical dependency audit findings. |
| Accessibility | axe-core snapshots; semantic/keyboard unit tests | zero serious/critical axe violations; all controls keyboard reachable and labeled. |
| Extension integration | text-document provider registration, title-command raw→preview and preview→source same group, `priority: option`, `vscode.openWith` fallback, unsaved/external update, malformed/unsupported controlled states, revision coalescing, cancellation/disposal/split watchers | current supported VS Code engine passes headless integration; development/test-only in-memory observation of already-posted DTOs proves panel results without adding a production API; no `WorkspaceEdit` or custom-editor source write path. Native title-button pixels, console output, and scroll geometry remain manual evidence. |
| Webview integration | init/revision/page sequence, stale/unknown message ignored, reload/error states, theme tokens, oversized nested DTO rejection | all protocol cases pass; page DOM ≤100 cards and each card has ≤64 validated/rendered blocks. |
| Performance | benchmark fixtures, hostile cardinality regression, and repeated reload profiling | targets in [PERFORMANCE.md](PERFORMANCE.md); CI parser ≤2 s for 5 MiB fixture; 20 MiB must retain bounded protocol/DOM and avoid multi-second parse/normalize samples; 50 MiB must reach the explicit admission-limit state; no >20% baseline regression. |
| Packaging | `vsce package`/equivalent, contents audit, licenses/notices, size, dependency audit | package ≤2 MiB compressed excluding VS Code metadata; no Pi runtime/export vendors unless explicitly approved/noticed. |
| Manual smoke | dark/light/high-contrast, 200% zoom, keyboard and screen reader, normal/malformed/large input, raw escape hatch | all flows pass on supported OS/VS Code matrix before release. |

## Pi-export parity harness
The harness is observational, not a golden UI test. For each reference fixture it:
1. runs installed `pi --export input.jsonl output.html` in a temp directory with telemetry/version check disabled;
2. extracts and base64-decodes `script#session-data`;
3. asserts documented facts: CLI keys `{header,entries,leafId}`, entries include full tree, v1 migration behavior is recorded but viewer source bytes stay unchanged, and observed leaf/path reference;
4. compares the preview normalized active path and supported-entry semantics to the parity matrix—not standalone HTML markup, CSS, vendors, or unsafe exporter interactions.

Any Pi version change reruns the harness, updates a dated reference report, and requires review of [PI-EXPORT-REFERENCE.md](PI-EXPORT-REFERENCE.md). A changed behavior is not adopted automatically.

## Release evidence
Attach test commands/versions, fixture results, benchmark report, package contents/size, audit output, manual matrix initials, and a visual/a11y review. Keep only durable summaries such as `docs/pi-session-preview/evidence/large-file-benchmark.md`; generated JSONL, heap snapshots, CPU profiles, and temporary benchmark directories must stay ignored. A failing security, raw-editor-toggle, malformed recovery, accessibility, or explicit-large-file-limit gate blocks release.