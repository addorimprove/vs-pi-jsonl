import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';

const fixtureDirectory = join(process.cwd(), 'src', 'test', 'fixtures', 'parser');

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtureDirectory, name)));
}

function parseFixture(name: string, limits = DEFAULT_PARSE_LIMITS) {
  const bytes = fixture(name);
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: name, limits });
  assert.deepEqual(bytes, before, `parser mutated fixture ${name}`);
  return result;
}

test('parses the BOM/CRLF v1 fixture without rewriting its source', () => {
  const bytes = fixture('bom-crlf-v1.jsonl');
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: 'bom-crlf-v1.jsonl', limits: DEFAULT_PARSE_LIMITS });

  assert.deepEqual(bytes, before);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(result.header?.sourceLine, 1);
  assert.equal(result.source.version, 1);
  assert.deepEqual(result.records.map(({ id, parentId, sourceLine }) => ({ id, parentId, sourceLine })), [
    { id: 'v1:2', parentId: null, sourceLine: 2 },
    { id: 'v1:3', parentId: 'v1:2', sourceLine: 3 }
  ]);
  assert.equal(result.records[1]?.fields.firstKeptEntryId, 'v1:2');
  assert.equal(result.records[1]?.fields.firstKeptEntryIndex, undefined);
});

test('normalizes stored v2 and v3 identities, including the v3 hookMessage compatibility role', () => {
  const v2 = parseFixture('v2.jsonl');
  const v3 = parseFixture('v3.jsonl');

  assert.equal(v2.source.version, 2);
  assert.deepEqual(v2.records.map(({ id, parentId, kind }) => ({ id, parentId, kind })), [
    { id: 'root', parentId: null, kind: 'user' },
    { id: 'label', parentId: 'root', kind: 'label' }
  ]);
  assert.equal(v2.records[1]?.fields.label, 'fixture label');
  assert.equal(v3.source.version, 3);
  assert.deepEqual(v3.records.map(({ id, parentId, role, kind }) => ({ id, parentId, role, kind })), [
    { id: 'legacy', parentId: null, role: 'custom', kind: 'customMessage' },
    { id: 'assistant', parentId: 'legacy', role: 'assistant', kind: 'assistant' }
  ]);
  assert.deepEqual(v3.records[1]?.content, [
    { kind: 'thinking', text: 'consider' },
    { kind: 'text', text: 'answer' }
  ]);
});

test('adapts current pi-subagents child transcripts into one bounded linear conversation', () => {
  const result = parseFixture('subagent-child-transcript.jsonl');

  assert.equal(result.header?.sessionId, 'synthetic-run');
  assert.equal(result.header?.cwd, '/synthetic/project');
  assert.equal(result.header?.fields.format, 'pi-subagents-child-transcript');
  assert.equal(result.header?.fields.agent, 'reviewer');
  assert.equal(result.source.version, 'unknown');
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'missing-header'), false);
  assert.deepEqual(result.records.map(({ id, parentId, sourceLine, kind }) => ({ id, parentId, sourceLine, kind })), [
    { id: 'subagent:2', parentId: null, sourceLine: 2, kind: 'user' },
    { id: 'subagent:3', parentId: 'subagent:2', sourceLine: 3, kind: 'assistant' },
    { id: 'subagent:6', parentId: 'subagent:3', sourceLine: 6, kind: 'tool' },
    { id: 'subagent:7', parentId: 'subagent:6', sourceLine: 7, kind: 'customMessage' },
    { id: 'subagent:8', parentId: 'subagent:7', sourceLine: 8, kind: 'customMessage' },
    { id: 'subagent:9', parentId: 'subagent:8', sourceLine: 9, kind: 'customMessage' }
  ]);
  assert.deepEqual(result.records[0]?.content, [{ kind: 'text', text: 'Task: Review the change.' }]);
  assert.equal(result.model.items.some((item) => item.sourceLine === 1), false, 'the writer-only initial prompt is replaced by Pi’s runtime user message');
  assert.deepEqual(result.model.items.filter((item) => item.sourceId === 'subagent:3').map((item) => item.blocks ?? item.tool), [
    [
      { kind: 'text', text: 'Inspecting the change.' },
      { kind: 'thinking', text: 'Check the relevant file.' }
    ],
    { callId: 'call-1', name: 'read', argumentsText: '{"path":"src/example.ts"}', resultText: 'export const answer = 42;', isError: false },
    { callId: 'call-2', name: 'bash', argumentsText: '{"command":"npm test"}' }
  ]);
  assert.deepEqual(result.model.items.slice(-3).map(({ title, blocks }) => ({ title, text: blocks?.[0]?.text })), [
    { title: 'Standard output', text: 'runner output' },
    { title: 'Standard error', text: 'runner warning' },
    { title: 'Transcript truncated', text: 'Child transcript exceeded 1024 bytes; further records were omitted.' }
  ]);
  assert.equal(result.model.items.some((item) => item.sourceLine === 4 || item.sourceLine === 5), false, 'redundant uncorrelated tool lifecycle markers are omitted');
  assert.equal(result.diagnostics.length, 0);
});

test('best-effort parses future versions while preserving the declared version and warning', () => {
  const result = parseFixture('future-version.jsonl');

  assert.equal(result.source.version, 'unknown');
  assert.equal(result.header?.declaredVersion, 99);
  assert.deepEqual(result.records.map(({ id, type, kind }) => ({ id, type, kind })), [
    { id: 'future', type: 'future_entry', kind: 'unknown' }
  ]);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'unsupported-version', line: 1 }
  ]);
});

test('returns empty safe results for an empty fixture and recovers non-Pi JSONL around a late header', () => {
  const empty = parseFixture('empty.jsonl');
  const nonPi = parseFixture('non-pi.jsonl');

  assert.equal(empty.source.linesSeen, 0);
  assert.deepEqual(empty.records, []);
  assert.deepEqual(empty.diagnostics.map((diagnostic) => diagnostic.code), ['missing-header']);
  assert.deepEqual(nonPi.records.map((entry) => entry.id), ['standalone', 'after']);
  assert.deepEqual(nonPi.diagnostics.map((diagnostic) => diagnostic.code), ['duplicate-header', 'missing-header']);
  assert.equal(nonPi.records[1]?.fields.flag, true);
});

test('contains null and missing content as safe empty or unknown summaries', () => {
  const result = parseFixture('null-missing-content.jsonl');

  assert.deepEqual(result.records.map(({ id, content }) => ({ id, content })), [
    { id: 'missing', content: [] },
    { id: 'null', content: [{ kind: 'unknown', metadata: { valueType: 'null' } }] },
    { id: 'custom-missing', content: [] },
    { id: 'custom-null', content: [{ kind: 'unknown', metadata: { valueType: 'null' } }] }
  ]);
  assert.equal(result.diagnostics.length, 0);
});

test('recovers valid entries surrounding malformed middle and final physical lines', () => {
  const result = parseFixture('malformed-middle-final.jsonl');

  assert.deepEqual(result.records.map(({ id, sourceLine }) => ({ id, sourceLine })), [
    { id: 'before', sourceLine: 2 },
    { id: 'after', sourceLine: 5 }
  ]);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'invalid-json', line: 3 },
    { code: 'non-object-record', line: 4 },
    { code: 'invalid-json', line: 6 }
  ]);
  assert.match(result.diagnostics[2]?.message ?? '', /incomplete trailing/i);
});

test('skips duplicate entry IDs and treats a late session object as a duplicate header', () => {
  const result = parseFixture('duplicate-ids.jsonl');

  assert.deepEqual(result.records.map((entry) => entry.id), ['kept', 'tail']);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'duplicate-header', line: 4 },
    { code: 'duplicate-id', line: 3 }
  ]);
});

test('skips only an oversized individual record and continues to the following record', () => {
  const result = parseFixture('oversized-record.jsonl', { ...DEFAULT_PARSE_LIMITS, maxRecordBytes: 200 });

  assert.deepEqual(result.records.map(({ id, sourceLine }) => ({ id, sourceLine })), [{ id: 'after', sourceLine: 3 }]);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'record-limit', line: 2 }]);
  assert((result.diagnostics[0]?.detail?.count ?? 0) > 200);
  assert.equal(result.diagnostics[0]?.detail?.limit, 200);
});

test('retains unknown roles and safe unknown fields without leaking nested, detail, or media payloads', () => {
  const result = parseFixture('unknown-role-fields.jsonl');
  const [unknownRole, unknownEntry] = result.records;

  assert.equal(result.header?.fields.safeFlag, true);
  assert.deepEqual({ ...unknownRole?.fields }, { safeText: 'keep', safeNumber: 4 });
  assert.equal(unknownRole?.role, 'observer');
  assert.equal(unknownRole?.kind, 'unknown');
  assert.deepEqual(
    unknownRole?.content.map((block) => block.kind === 'unknown'
      ? { ...block, metadata: { ...block.metadata } }
      : block),
    [
      { kind: 'unknown', metadata: { body: '# opaque', safe: 7 } },
      { kind: 'media', omitted: { reason: 'media-omitted', originalSize: 12 } }
    ]
  );
  assert.deepEqual({ ...unknownEntry?.fields }, { safe: false });
  assert.deepEqual(unknownEntry?.content, [{ kind: 'text', text: 'opaque text' }]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['not-retained', 'secret', '"drop"']) {
    assert.equal(serialized.includes(forbidden), false, `result leaked ${forbidden}`);
  }
});

test('recognizes every documented known entry shape and preserves custom-message visibility metadata', () => {
  const result = parseFixture('all-known-entries.jsonl');

  assert.deepEqual(result.records.map((entry) => entry.kind), [
    'user', 'assistant', 'tool', 'bash', 'customMessage', 'compaction', 'branchSummary', 'unknown',
    'customMessage', 'customMessage', 'modelChange', 'thinkingChange', 'label', 'sessionInfo'
  ]);
  assert.equal(result.records[7]?.type, 'custom');
  assert.equal(result.records[9]?.hidden, true);
  assert.equal(result.model.summary.hiddenCustomCount, 1);
  assert.equal(result.records[5]?.fields.firstKeptEntryId, 'user');
  assert.equal(result.records[6]?.fields.fromId, 'user');
  assert.equal(result.records[10]?.fields.modelId, 'model');
  assert.equal(result.records[13]?.fields.name, 'fixture');
});
