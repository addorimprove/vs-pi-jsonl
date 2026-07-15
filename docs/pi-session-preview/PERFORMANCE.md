# Performance and resource budget

## Default v1 limits
These are conservative defaults, configurable only internally until product validation:

| Resource | Limit | Behavior |
|---|---:|---|
| File read | 20 MiB | Admit and fully parse bounded local files; known larger files show an explicit limit state at the file-stat preflight, with a post-read race checked again before parsing. |
| Physical lines | 50,000 | Stop after limit; diagnostic with count. |
| One JSONL record | 512 KiB | Skip record and diagnose. |
| JSON nesting | 64 | Skip/opaque record and diagnose. |
| Normalized active-path items | 10,000 | Retain nearest/latest bounded path window; diagnostic. |
| Display text per block | 32,000 chars | Truncate with explicit indicator. |
| Content blocks per parsed entry/rendered card | 64 | Retain a bounded prefix; replace the remainder with one counted omission notice. |
| Tool argument/result display | 16,000 chars each | Serialize with a 1,024-node traversal budget and truncate before allocating per-member work. |
| First page / subsequent page | up to 50 items / up to 50 items | Extension sends one bounded page; the newest final page may be partial. |
| Simultaneously mounted cards | 100 | Replace/virtualize prior page, retaining navigation context. |
| Image/base64 payload | 0 bytes rendered | Omit media in v1. |
| Diagnostics | 100 | Collapse additional malformed-input notices into one counted diagnostic before the protocol/DOM boundary. |

Limits are defense-in-depth, not a promise to load arbitrary files. Implementations must count bytes/chars incrementally where possible and avoid quadratic joins, recursive tree walks, unbounded `JSON.stringify`, unbounded/dependency Markdown parsing, and syntax autodetection. The parser frames directly from the bounded byte buffer (rather than decoding/splitting the full file), caps content cardinality before projection, and serializes tool arguments with a fixed traversal budget rather than staging an attacker-sized token array. The dirty-buffer admission check counts UTF-8 bytes before allocating a duplicate encoded buffer. The renderer validates and defensively slices content blocks before DOM creation; its small line-oriented Markdown subset operates only on already bounded display blocks.

## Targets (release hardware baseline)
For a 5 MiB, 10k-record valid session on a supported desktop VS Code build:
- provider read + parse + normalize: p95 ≤ 750 ms;
- initial `init` plus up to 50 rendered items: p95 ≤ 250 ms after model ready;
- page action: p95 ≤ 100 ms;
- idle webview DOM: ≤100 cards and no retained full raw JSON string;
- repeated reload (10): no monotonic listener/DOM growth; provider disposal releases watcher/model references.

Benchmark reports record count/bytes, machine/VS Code/Node versions, p50/p95, heap trend when available, DOM cardinality, and limits hit. CI uses a less noisy guard: parser 5 MiB fixture ≤2 s and page payload ≤1 MiB; regressions >20% need investigation. The reproducible synthetic 1/5/20/50 MiB benchmark and its durable result are `npm run benchmark:large` and [evidence/large-file-benchmark.md](evidence/large-file-benchmark.md); generated fixtures live only in an OS temporary directory and are removed after the run.

## Rendering strategy
The extension host holds only bounded normalized data. It sends a summary, at most 100 diagnostics, and one page after webview readiness, uses revision IDs/request supersession to drop stale work, debounces exact-file and exact-`TextDocument` updates (~250 ms), honors cancellation, and does not use `retainContextWhenHidden`. The webview creates DOM only for the page, preserves numeric scroll position, and auto-follows a refresh only when the reader was already within 96 px of the bottom. No CDN, remote image, large Markdown/highlight vendor, full-tree sidebar, or exporter template is bundled.

## Failure posture
Limit hits preserve the raw editor escape hatch and show an actionable limit diagnostic. They never retry endlessly, disable source editing, or write a migrated file.