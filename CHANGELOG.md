# Changelog

All notable changes are documented here.

## 0.0.1 — 2026-07-16

### Added
- Optional option-priority `*.jsonl` custom editor with editor-title raw/preview/source actions and **Open With…** fallback.
- Read-only local Pi session v1–v3 parsing, latest-active-path projection, bounded paging, live refresh, malformed-input recovery, and diagnostics.
- A restrictive-CSP, DOM-only, accessible webview with safe Markdown subset rendering.
- Parser, projection, protocol, DOM/accessibility, packaging, performance, and VS Code Extension Development Host coverage.

### Security and privacy
- No Pi runtime, source edit/save path, network, telemetry, remote assets, custom-tool HTML execution, or workspace scan.
- Fixed bounded-work handling for hostile content-block and tool-argument cardinality before this release candidate.

### Compatibility and known limits
- Supports desktop VS Code 1.127+ local `file:` documents only.
- See [README.md](README.md), [docs/pi-session-preview/DECISIONS.md](docs/pi-session-preview/DECISIONS.md), and the [final report](docs/pi-session-preview/evidence/final-report.md) for deferred functionality and residual risks.
