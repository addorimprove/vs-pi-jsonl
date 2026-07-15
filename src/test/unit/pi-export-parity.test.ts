import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';

type Expected = {
  readonly fixture: string;
  readonly activeLeafId: string;
  readonly activePathIds: readonly string[];
  readonly visibleSourceIds: readonly string[];
  readonly hiddenCustomCount: number;
  readonly matchedTool: { readonly callId: string; readonly name: string; readonly resultText: string };
  readonly compaction: string;
  readonly visibleCustom: string;
  readonly hiddenCustomSourceId: string;
};
type ExportEntry = { readonly id?: unknown; readonly parentId?: unknown; readonly type?: unknown; readonly display?: unknown; readonly summary?: unknown; readonly content?: unknown; readonly message?: { readonly role?: unknown; readonly content?: unknown } };
type PiExport = { readonly header?: unknown; readonly entries?: unknown; readonly leafId?: unknown };

const fixtureDirectory = join(process.cwd(), 'src', 'test', 'fixtures', 'projection');
const expected = JSON.parse(readFileSync(join(fixtureDirectory, 'pi-export-semantics.expected.json'), 'utf8')) as Expected;
const fixturePath = join(fixtureDirectory, `${expected.fixture}.jsonl`);
const piAvailable = spawnSync('pi', ['--version'], { stdio: 'ignore' }).status === 0;

function previewSemantics(): void {
  const result = parsePiSession({
    bytes: new Uint8Array(readFileSync(fixturePath)),
    uriLabel: `${expected.fixture}.jsonl`,
    limits: DEFAULT_PARSE_LIMITS
  });
  assert.equal(result.model.summary.activeLeafId, expected.activeLeafId);
  assert.deepEqual(result.model.activePathIds, expected.activePathIds);
  assert.deepEqual(result.model.items.map((item) => item.sourceId), expected.visibleSourceIds);
  assert.equal(result.model.summary.hiddenCustomCount, expected.hiddenCustomCount);
  const matchedTool = result.model.items.find((item) => item.tool?.callId === expected.matchedTool.callId)?.tool;
  assert.deepEqual(matchedTool === undefined ? undefined : { callId: matchedTool.callId, name: matchedTool.name, resultText: matchedTool.resultText }, expected.matchedTool);
  assert.equal(result.model.items.find((item) => item.kind === 'compaction')?.blocks?.[0]?.text, expected.compaction);
  assert.equal(result.model.items.find((item) => item.sourceId === 'visible-custom')?.blocks?.[0]?.text, expected.visibleCustom);
  assert.equal(result.model.items.some((item) => item.sourceId === expected.hiddenCustomSourceId), false);
}

test('checked preview semantics remain deterministic without a Pi installation', () => {
  previewSemantics();
});

test('observed pi --export semantics match the reviewed active-path, role/content, tool, compaction, and custom-message facts', { skip: !piAvailable }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-session-preview-parity-'));
  const input = join(directory, 'input.jsonl');
  const output = join(directory, 'export.html');
  try {
    copyFileSync(fixturePath, input);
    execFileSync('pi', ['--export', input, output], {
      env: { ...process.env, PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' },
      stdio: 'pipe',
      timeout: 30_000
    });
    assert.equal(existsSync(output), true);
    const exported = decodeExport(readFileSync(output, 'utf8'));
    assert.deepEqual(Object.keys(exported).sort(), ['entries', 'header', 'leafId']);
    assert.equal(exported.leafId, expected.activeLeafId);
    assert(Array.isArray(exported.entries));
    const entries = exported.entries as ExportEntry[];
    assert.deepEqual(activePath(entries, exported.leafId), expected.activePathIds);

    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    assert.equal(byId.get('root')?.message?.role, 'user');
    assert.equal(byId.get('main-user')?.message?.content, 'Use the main branch.');
    const assistant = byId.get('assistant');
    assert.equal(assistant?.message?.role, 'assistant');
    assert.deepEqual((assistant?.message?.content as Array<{ type?: unknown; id?: unknown; name?: unknown }>).filter((block) => block.type === 'toolCall').map((block) => ({ id: block.id, name: block.name })), [
      { id: expected.matchedTool.callId, name: expected.matchedTool.name },
      { id: 'call-2', name: 'second_tool' }
    ]);
    assert.equal(byId.get('matched-result')?.message?.content, expected.matchedTool.resultText);
    assert.equal(byId.get('compaction')?.summary, expected.compaction);
    assert.equal(byId.get('visible-custom')?.display, true);
    assert.equal(byId.get('visible-custom')?.content, expected.visibleCustom);
    assert.equal(byId.get(expected.hiddenCustomSourceId)?.display, false);
    previewSemantics();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function decodeExport(html: string): PiExport {
  const match = /<script[^>]*id="session-data"[^>]*>([^<]+)<\/script>/.exec(html);
  assert(match !== null, 'Pi export did not contain session-data');
  return JSON.parse(Buffer.from(match[1] ?? '', 'base64').toString('utf8')) as PiExport;
}

function activePath(entries: readonly ExportEntry[], leafId: unknown): string[] {
  assert.equal(typeof leafId, 'string');
  const activeLeafId = leafId as string;
  const byId = new Map(entries.filter((entry): entry is ExportEntry & { id: string } => typeof entry.id === 'string').map((entry) => [entry.id, entry]));
  const reverse: string[] = [];
  let id: string | null = activeLeafId;
  while (id !== null) {
    const entry = byId.get(id);
    assert(entry !== undefined, `Pi export active leaf references missing entry ${id}`);
    reverse.push(id);
    id = typeof entry.parentId === 'string' ? entry.parentId : null;
  }
  return reverse.reverse();
}
