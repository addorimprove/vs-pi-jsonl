import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';

function parse(text: string) {
  return parsePiSession({
    bytes: new TextEncoder().encode(text),
    uriLabel: 'synthetic.jsonl',
    limits: DEFAULT_PARSE_LIMITS
  });
}

test('normalizes v1 records linearly without changing input bytes', () => {
  const text = [
    '{"type":"session","id":"s","cwd":"/safe"}',
    '{"type":"message","message":{"role":"user","content":"hello"}}',
    '{"type":"compaction","summary":"short","firstKeptEntryIndex":1}'
  ].join('\r\n');
  const bytes = new TextEncoder().encode(text);
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: 'v1.jsonl', limits: DEFAULT_PARSE_LIMITS });

  assert.deepEqual(bytes, before);
  assert.equal(result.source.version, 1);
  assert.deepEqual(result.records.map(({ id, parentId }) => ({ id, parentId })), [
    { id: 'v1:2', parentId: null },
    { id: 'v1:3', parentId: 'v1:2' }
  ]);
  assert.equal(result.records[1]?.fields.firstKeptEntryId, 'v1:2');
  assert.equal(result.records[1]?.fields.firstKeptEntryIndex, undefined);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.records));
});

test('recovers valid v2/v3 records around malformed input and diagnoses duplicate IDs', () => {
  const result = parse([
    '{"type":"session","version":3,"id":"s"}',
    '',
    '{"type":"message","id":"one","parentId":null,"message":{"role":"hookMessage","content":"legacy"}}',
    '{bad json',
    '[]',
    '{"type":"mystery","id":"two","parentId":"one","title":"keep me","flag":true,"content":"opaque"}',
    '{"type":"message","id":"two","parentId":"one","message":{"role":"user","content":"duplicate"}}',
    '{"type":"message","id":"tail","parentId":"two"'
  ].join('\n'));

  assert.equal(result.source.version, 3);
  assert.deepEqual(result.records.map((entry) => entry.id), ['one', 'two']);
  assert.equal(result.records[0]?.role, 'custom');
  assert.equal(result.records[1]?.kind, 'unknown');
  assert.equal(result.records[1]?.fields.title, 'keep me');
  assert.equal(result.records[1]?.fields.flag, true);
  assert.deepEqual(result.records[1]?.content, [{ kind: 'text', text: 'opaque' }]);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
    'invalid-json',
    'non-object-record',
    'invalid-json',
    'duplicate-id'
  ]);
  assert.match(result.diagnostics[2]?.message ?? '', /incomplete trailing/i);
});

test('keeps a lone child-transcript initial prompt while recovering an incomplete live tail', () => {
  const result = parse([
    '{"version":1,"recordType":"message","source":"async","runId":"live-run","agent":"worker","cwd":"/synthetic","timestamp":"2026-07-17T00:00:00.000Z","sourceEventType":"initial_prompt","role":"user","text":"Run the task."}',
    '{"version":1'
  ].join('\n'));

  assert.equal(result.header?.sessionId, 'live-run');
  assert.deepEqual(result.records.map(({ id, parentId, role, content }) => ({ id, parentId, role, content })), [
    { id: 'subagent:1', parentId: null, role: 'user', content: [{ kind: 'text', text: 'Run the task.' }] }
  ]);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'invalid-json', line: 2 }]);
  assert.match(result.diagnostics[0]?.message ?? '', /incomplete trailing/i);
});

test('future versions remain best effort and invalid record IDs do not enter the handoff', () => {
  const result = parse([
    '{"type":"session","version":99,"id":"s"}',
    '{"type":"mystery","id":"kept","parentId":null,"headline":"future"}',
    '{"type":"mystery","parentId":null}'
  ].join('\n'));

  assert.equal(result.source.version, 'unknown');
  assert.deepEqual(result.records.map((entry) => entry.id), ['kept']);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-version'));
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-id'));
  assert.deepEqual(result.model.activePathIds, ['kept']);
  assert.deepEqual(result.model.items.map((item) => ({ kind: item.kind, title: item.title })), [
    { kind: 'unknown', title: 'Unknown entry: mystery' }
  ]);
});
