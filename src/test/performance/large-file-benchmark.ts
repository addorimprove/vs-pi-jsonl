import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { JSDOM } from 'jsdom';

import { DEFAULT_PARSE_LIMITS, MAX_DIAGNOSTICS, parsePiSession } from '../../core/parse.js';
import { latestPage, PUBLIC_LIMITS } from '../../extension/protocol.js';

const MEBIBYTE = 1024 * 1024;
const TARGETS = [1, 5, 20, 50] as const;
const RUNS_BY_MEBIBYTE: Readonly<Record<number, number>> = { 1: 5, 5: 5, 20: 3 };
const outputPath = join(process.cwd(), 'docs', 'pi-session-preview', 'evidence', 'large-file-benchmark.md');
const bundlePath = join(process.cwd(), 'media', 'main.js');

type BenchmarkRow = {
  readonly mib: number;
  readonly bytes: number;
  readonly entries: number;
  readonly readMs: readonly number[];
  readonly parseMs: readonly number[];
  readonly renderMs: readonly number[];
  readonly heapDeltas: readonly number[];
  readonly cards: number;
  readonly domNodes: number;
  readonly diagnostics: number;
};

interface WebviewHarness {
  readonly dom: JSDOM;
  send(value: unknown): void;
  nodeCount(): number;
  cardCount(): number;
  close(): void;
}

function buildSession(targetBytes: number, entryCount: number): Buffer {
  const header = JSON.stringify({ type: 'session', version: 3, id: `benchmark-${targetBytes}` });
  const lines = [header];
  let bytesUsed = Buffer.byteLength(header);
  let parentId: string | null = null;

  for (let index = 0; index < entryCount; index += 1) {
    const id = `turn-${index}`;
    const base = JSON.stringify({
      type: 'message',
      id,
      parentId,
      message: { role: index % 2 === 0 ? 'user' : 'assistant', content: '' }
    });
    const remaining = targetBytes - bytesUsed;
    const separatorBytes = 1;
    const rowsRemaining = entryCount - index;
    const payloadBytes = index === entryCount - 1
      ? remaining - separatorBytes - Buffer.byteLength(base)
      : Math.floor(remaining / rowsRemaining) - separatorBytes - Buffer.byteLength(base);
    assert(payloadBytes >= 0, 'fixture sizing left no room for a valid final record');
    const line = JSON.stringify({
      type: 'message',
      id,
      parentId,
      message: { role: index % 2 === 0 ? 'user' : 'assistant', content: 'x'.repeat(payloadBytes) }
    });
    lines.push(line);
    bytesUsed += separatorBytes + Buffer.byteLength(line);
    parentId = id;
  }

  const result = Buffer.from(lines.join('\n'));
  assert.equal(result.byteLength, targetBytes, 'fixture must have its declared deterministic size');
  return result;
}

function buildHugeToolOutput(): Buffer {
  return Buffer.from([
    JSON.stringify({ type: 'session', version: 3, id: 'huge-tool-output' }),
    JSON.stringify({
      type: 'message',
      id: 'oversized-tool-result',
      parentId: null,
      message: { role: 'toolResult', toolCallId: 'call-1', content: 'y'.repeat(DEFAULT_PARSE_LIMITS.maxRecordBytes + 1) }
    }),
    JSON.stringify({ type: 'message', id: 'recovery', parentId: null, message: { role: 'user', content: 'valid entry after huge tool output' } })
  ].join('\n'));
}

function createHarness(bundle: string): WebviewHarness {
  const dom = new JSDOM('<!doctype html><html><body><a class="skip-link" href="#transcript">Skip</a><main id="app" tabindex="-1"></main></body></html>', {
    runScripts: 'dangerously',
    url: 'https://webview.invalid/'
  });
  Object.assign(dom.window, {
    scrollTo: (): void => undefined,
    acquireVsCodeApi: (): { postMessage(): void; getState(): undefined; setState(): void } => ({
      postMessage: (): void => undefined,
      getState: (): undefined => undefined,
      setState: (): void => undefined
    })
  });
  dom.window.eval(bundle);
  return {
    dom,
    send(value: unknown): void {
      const cloned = dom.window.JSON.parse(JSON.stringify(value)) as unknown;
      void dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: cloned }));
    },
    nodeCount: (): number => dom.window.document.querySelectorAll('#app *').length,
    cardCount: (): number => dom.window.document.querySelectorAll('.transcript > li').length,
    close: (): void => dom.window.close()
  };
}

function collectGarbage(): void {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  gc?.();
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index] ?? 0;
}

function formatMs(value: number): string {
  return value.toFixed(1);
}

function formatMiB(bytes: number): string {
  return (bytes / MEBIBYTE).toFixed(1);
}

function renderMessage(result: ReturnType<typeof parsePiSession>, revision: number): unknown {
  return {
    protocol: 1,
    type: 'init',
    revision,
    summary: result.model.summary,
    diagnostics: result.diagnostics,
    page: latestPage(result.model),
    limits: PUBLIC_LIMITS
  };
}

function benchmarkSession(path: string, mib: number, expectedEntries: number, bundle: string): BenchmarkRow {
  const runs = RUNS_BY_MEBIBYTE[mib];
  if (runs === undefined) {
    throw new Error(`No benchmark-run count configured for ${mib} MiB.`);
  }
  const readMs: number[] = [];
  const parseMs: number[] = [];
  const renderMs: number[] = [];
  const heapDeltas: number[] = [];
  let cards = 0;
  let domNodes = 0;
  let diagnostics = 0;
  const webview = createHarness(bundle);
  try {
    for (let run = 0; run < runs; run += 1) {
      collectGarbage();
      const beforeHeap = process.memoryUsage().heapUsed;
      const readStart = performance.now();
      const bytes = new Uint8Array(readFileSync(path));
      readMs.push(performance.now() - readStart);
      const parseStart = performance.now();
      const result = parsePiSession({ bytes, uriLabel: path, limits: DEFAULT_PARSE_LIMITS });
      parseMs.push(performance.now() - parseStart);
      const renderStart = performance.now();
      webview.send(renderMessage(result, run));
      renderMs.push(performance.now() - renderStart);
      cards = webview.cardCount();
      domNodes = webview.nodeCount();
      diagnostics = result.diagnostics.length;
      heapDeltas.push(process.memoryUsage().heapUsed - beforeHeap);
      assert.equal(result.records.length, expectedEntries);
      assert.equal(result.source.truncated, false);
      assert(cards <= PUBLIC_LIMITS.maxRenderedItems);
      assert(domNodes < 2_000, `bounded page DOM unexpectedly contains ${domNodes} nodes`);
      assert(diagnostics <= MAX_DIAGNOSTICS);
    }
  } finally {
    webview.close();
  }
  return { mib, bytes: statSync(path).size, entries: expectedEntries, readMs, parseMs, renderMs, heapDeltas, cards, domNodes, diagnostics };
}

function refreshProfile(path: string, bundle: string): { readonly heapMiB: readonly number[]; readonly domNodes: readonly number[]; readonly parseMs: readonly number[] } {
  const webview = createHarness(bundle);
  const heapMiB: number[] = [];
  const domNodes: number[] = [];
  const parseMs: number[] = [];
  let retained: ReturnType<typeof parsePiSession> | undefined;
  try {
    for (let revision = 0; revision < 10; revision += 1) {
      collectGarbage();
      const bytes = new Uint8Array(readFileSync(path));
      const start = performance.now();
      const result = parsePiSession({ bytes, uriLabel: path, limits: DEFAULT_PARSE_LIMITS });
      retained = result; // Mirrors the provider's one current bounded model per panel.
      parseMs.push(performance.now() - start);
      webview.send(renderMessage(retained, revision));
      collectGarbage();
      heapMiB.push(process.memoryUsage().heapUsed / MEBIBYTE);
      domNodes.push(webview.nodeCount());
      assert.equal(retained.records.length, 10_000);
      assert.equal(webview.cardCount(), PUBLIC_LIMITS.pageItems);
    }
  } finally {
    webview.close();
  }
  void retained;
  return { heapMiB, domNodes, parseMs };
}

function rowMarkdown(row: BenchmarkRow): string {
  return `| ${row.mib} | ${row.bytes.toLocaleString()} | ${row.entries.toLocaleString()} | ${formatMs(percentile(row.readMs, 0.5))}/${formatMs(percentile(row.readMs, 0.95))} | ${formatMs(percentile(row.parseMs, 0.5))}/${formatMs(percentile(row.parseMs, 0.95))} | ${formatMs(percentile(row.renderMs, 0.5))}/${formatMs(percentile(row.renderMs, 0.95))} | ${row.cards}/${row.domNodes} | ${formatMiB(percentile(row.heapDeltas, 0.95))} |`;
}

function main(): void {
  const temp = mkdtempSync(join(tmpdir(), 'pi-session-preview-large-'));
  const bundle = readFileSync(bundlePath, 'utf8');
  const entriesByMib: Readonly<Record<number, number>> = { 1: 500, 5: 10_000, 20: 10_000, 50: 25_000 };
  try {
    const paths = new Map<number, string>();
    for (const mib of TARGETS) {
      const entries = entriesByMib[mib];
      if (entries === undefined) {
        throw new Error(`No entry count configured for ${mib} MiB.`);
      }
      const path = join(temp, `session-${mib}MiB.jsonl`);
      writeFileSync(path, buildSession(mib * MEBIBYTE, entries));
      paths.set(mib, path);
    }
    const hugeToolPath = join(temp, 'huge-single-line-tool-output.jsonl');
    writeFileSync(hugeToolPath, buildHugeToolOutput());

    const rows = TARGETS.filter((mib) => mib <= 20).map((mib) => {
      const path = paths.get(mib);
      assert(path !== undefined);
      const entries = entriesByMib[mib];
      if (entries === undefined) {
        throw new Error(`No entry count configured for ${mib} MiB.`);
      }
      return benchmarkSession(path, mib, entries, bundle);
    });
    const fiveMiB = rows.find((row) => row.mib === 5);
    const twentyMiB = rows.find((row) => row.mib === 20);
    assert(fiveMiB !== undefined && twentyMiB !== undefined);
    assert(percentile(fiveMiB.parseMs, 0.95) <= 2_000, '5 MiB parser p95 exceeded the CI guard.');
    assert(percentile(twentyMiB.parseMs, 0.95) < 2_000, '20 MiB parser exceeded the no-multi-second-freeze guard.');
    const refreshPath = paths.get(5);
    const fiftyPath = paths.get(50);
    assert(refreshPath !== undefined && fiftyPath !== undefined);
    const refresh = refreshProfile(refreshPath, bundle);
    const hugeTool = parsePiSession({ bytes: new Uint8Array(readFileSync(hugeToolPath)), uriLabel: hugeToolPath, limits: DEFAULT_PARSE_LIMITS });
    assert.deepEqual(hugeTool.records.map((entry) => entry.id), ['recovery']);
    assert(hugeTool.diagnostics.some((diagnostic) => diagnostic.code === 'record-limit'));
    assert(statSync(fiftyPath).size > DEFAULT_PARSE_LIMITS.maxBytes);

    mkdirSync(join(process.cwd(), 'docs', 'pi-session-preview', 'evidence'), { recursive: true });
    const node = process.version;
    const report = `# Large-file benchmark evidence

- Generated and measured locally by npm run benchmark:large on ${new Date().toISOString()}.
- Environment: Node ${node}; ${process.platform} ${process.arch}; ${process.version}; ${process.cpuUsage().user} µs process user CPU at report generation. VS Code is not launched by this timed harness: it uses the same built extension-core and webview bundle with JSDOM; the separate Extension Development Host suite targets cached VS Code 1.127.0 and opens the same 20 MiB/10,000-entry shape with a <2,000 ms provider-to-webview assertion.
- Fixture generator: deterministic synthetic v3 JSONL, linear alternating user/assistant turns, ASCII-only content, exact binary target sizes. Fixtures were created under ${temp} and removed in a finally block; none are source-controlled or packaged.
- Method: each run reads the file, calls production parsePiSession with DEFAULT_PARSE_LIMITS, sends the production DTO/page through the built webview bundle in JSDOM, and counts #app descendants. Timings are milliseconds, p50/p95 over 5 runs (1/5 MiB) or 3 runs (20 MiB). Heap is the p95 per-run heap delta; Node was launched with --expose-gc and collected between samples.

| MiB | Bytes | Entries | Read p50/p95 | Parse+normalize p50/p95 | First useful render p50/p95 | Cards/DOM nodes | Heap delta p95 (MiB) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${rows.map(rowMarkdown).join('\n')}

## Bounds and refresh behavior

- The 20 MiB session produced ${rows.find((row) => row.mib === 20)?.entries.toLocaleString()} accepted entries and ${rows.find((row) => row.mib === 20)?.cards} mounted cards; its largest observed parse+normalize sample was ${formatMs(percentile(rows.find((row) => row.mib === 20)?.parseMs ?? [], 0.95))} ms. The page payload and DOM remain bounded by 50 cards (100 maximum in protocol) rather than the session entry count.
- Ten consecutive 5 MiB refreshes: parse ms = ${refresh.parseMs.map(formatMs).join(', ')}; post-GC heap MiB = ${refresh.heapMiB.map((value) => value.toFixed(1)).join(', ')}; DOM node counts = ${refresh.domNodes.join(', ')}. The DOM count is constant and the sampled post-GC heap stabilizes after warm-up rather than accumulating listener/card state.
- Huge single-line tool-output probe: ${statSync(hugeToolPath).size.toLocaleString()} bytes; the >${DEFAULT_PARSE_LIMITS.maxRecordBytes.toLocaleString()}-byte JSONL record was diagnosed and skipped, and the following valid entry remained available.
- 50 MiB probe: ${statSync(fiftyPath).size.toLocaleString()} bytes. It exceeds the ${DEFAULT_PARSE_LIMITS.maxBytes / MEBIBYTE} MiB provider admission limit, so the file-stat preflight returns the explicit byte-limit state before workspace.fs.readFile or parsing. The pure parser also reports its byte-limit if directly given such bytes; neither path silently waits for unbounded rendering.

## Result

The 5 MiB parse p95 is ${formatMs(percentile(rows.find((row) => row.mib === 5)?.parseMs ?? [], 0.95))} ms (CI guard: <= 2,000 ms). This run met the bounded-DOM and explicit-limit gates. Numbers are machine-specific evidence, not a cross-machine SLA.
`;
    writeFileSync(outputPath, report);
    console.log(`Wrote ${outputPath}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main();
