# Large-file benchmark evidence

- Generated and measured locally by npm run benchmark:large on 2026-07-15T19:05:45.822Z.
- Environment: Node v24.14.0; darwin arm64; v24.14.0; 3202138 µs process user CPU at report generation. VS Code is not launched by this timed harness: it uses the same built extension-core and webview bundle with JSDOM; the separate Extension Development Host suite targets cached VS Code 1.127.0 and opens the same 20 MiB/10,000-entry shape with a <2,000 ms provider-to-webview assertion.
- Fixture generator: deterministic synthetic v3 JSONL, linear alternating user/assistant turns, ASCII-only content, exact binary target sizes. Fixtures were created under /var/folders/bg/_yjc40h55d12217qqhdrd6lr0000gp/T/pi-session-preview-large-8Y0UZU and removed in a finally block; none are source-controlled or packaged.
- Method: each run reads the file, calls production parsePiSession with DEFAULT_PARSE_LIMITS, sends the production DTO/page through the built webview bundle in JSDOM, and counts #app descendants. Timings are milliseconds, p50/p95 over 5 runs (1/5 MiB) or 3 runs (20 MiB). Heap is the p95 per-run heap delta; Node was launched with --expose-gc and collected between samples.

| MiB | Bytes | Entries | Read p50/p95 | Parse+normalize p50/p95 | First useful render p50/p95 | Cards/DOM nodes | Heap delta p95 (MiB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,048,576 | 500 | 0.3/0.4 | 5.6/7.0 | 6.7/11.7 | 50/365 | 11.9 |
| 5 | 5,242,880 | 10,000 | 1.4/1.5 | 47.9/59.1 | 6.3/6.9 | 50/365 | 65.9 |
| 20 | 20,971,520 | 10,000 | 5.3/10.7 | 78.1/90.1 | 6.3/6.8 | 50/365 | 44.1 |

## Bounds and refresh behavior

- The 20 MiB session produced 10,000 accepted entries and 50 mounted cards; its largest observed parse+normalize sample was 90.1 ms. The page payload and DOM remain bounded by 50 cards (100 maximum in protocol) rather than the session entry count.
- Ten consecutive 5 MiB refreshes: parse ms = 44.9, 45.9, 51.0, 44.3, 44.7, 40.8, 47.3, 42.1, 41.9, 46.7; post-GC heap MiB = 45.1, 46.5, 46.5, 46.5, 46.6, 46.6, 46.6, 46.6, 46.6, 46.6; DOM node counts = 365, 365, 365, 365, 365, 365, 365, 365, 365, 365. The DOM count is constant and the sampled post-GC heap stabilizes after warm-up rather than accumulating listener/card state.
- Huge single-line tool-output probe: 524,598 bytes; the >524,288-byte JSONL record was diagnosed and skipped, and the following valid entry remained available.
- 50 MiB probe: 52,428,800 bytes. It exceeds the 20 MiB provider admission limit, so the file-stat preflight returns the explicit byte-limit state before workspace.fs.readFile or parsing. The pure parser also reports its byte-limit if directly given such bytes; neither path silently waits for unbounded rendering.

## Result

The 5 MiB parse p95 is 59.1 ms (CI guard: <= 2,000 ms). This run met the bounded-DOM and explicit-limit gates. Numbers are machine-specific evidence, not a cross-machine SLA.
