import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, MAX_DIAGNOSTICS, parsePiSession } from '../../core/parse.js';

function parse(text: string, limits = DEFAULT_PARSE_LIMITS) {
  return parsePiSession({
    bytes: new TextEncoder().encode(text),
    uriLabel: 'boundary.jsonl',
    limits
  });
}

const header = '{"type":"session","version":3,"id":"limits"}';
const first = '{"type":"message","id":"one","parentId":null,"message":{"role":"user","content":"one"}}';
const second = '{"type":"message","id":"two","parentId":"one","message":{"role":"user","content":"two"}}';

test('ignores whitespace-only physical lines and reports an empty, headerless session', () => {
  const bytes = new Uint8Array(readFileSync(join(process.cwd(), 'src', 'test', 'fixtures', 'parser', 'whitespace-only.jsonl')));
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: 'whitespace-only.jsonl', limits: DEFAULT_PARSE_LIMITS });

  assert.deepEqual(bytes, before);
  assert.equal(result.source.linesSeen, 3);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), ['missing-header']);
});

test('enforces byte, physical-line, and accepted-entry limits deterministically', () => {
  const bytePrefix = `${header}\n`;
  const byteLimited = parse(`${bytePrefix}${first}`, { ...DEFAULT_PARSE_LIMITS, maxBytes: new TextEncoder().encode(bytePrefix).byteLength });
  const lineLimited = parse([header, first, second].join('\n'), { ...DEFAULT_PARSE_LIMITS, maxLines: 2 });
  const itemLimited = parse([header, first, second].join('\n'), { ...DEFAULT_PARSE_LIMITS, maxItems: 1 });

  assert.equal(byteLimited.source.bytesRead, new TextEncoder().encode(bytePrefix).byteLength);
  assert.equal(byteLimited.source.truncated, true);
  assert.deepEqual(byteLimited.records, []);
  assert.deepEqual(byteLimited.diagnostics.map((diagnostic) => diagnostic.code), ['byte-limit']);

  assert.equal(lineLimited.source.linesSeen, 2);
  assert.equal(lineLimited.source.truncated, true);
  assert.deepEqual(lineLimited.records.map((entry) => entry.id), ['one']);
  assert.deepEqual(lineLimited.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'record-limit', line: 3 }]);

  assert.equal(itemLimited.source.truncated, true);
  assert.deepEqual(itemLimited.records.map((entry) => entry.id), ['one']);
  assert.deepEqual(itemLimited.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'record-limit', line: 3 }]);
});

test('does not count a trailing newline as an extra physical record at the exact line limit', () => {
  const result = parse(`${header}\n${first}\n`, { ...DEFAULT_PARSE_LIMITS, maxLines: 2 });

  assert.equal(result.source.linesSeen, 2);
  assert.equal(result.source.truncated, false);
  assert.deepEqual(result.records.map((entry) => entry.id), ['one']);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'record-limit'), false);
});

test('skips too-deep records but recovers later valid records', () => {
  const deep = '{"type":"message","id":"deep","parentId":null,"message":{"role":"user","content":{"a":{"b":{"c":"too deep"}}}}}';
  const result = parse([header, deep, second].join('\n'), { ...DEFAULT_PARSE_LIMITS, maxDepth: 5 });

  assert.deepEqual(result.records.map((entry) => entry.id), ['two']);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'depth-limit', line: 2 },
    { code: 'missing-parent', line: 3 }
  ]);
});

test('diagnoses impossible entry field types while preserving a bounded unlinked record', () => {
  const result = parse([
    header,
    '{"type":null,"id":"bad-type","parentId":null}',
    '{"type":"message","id":"kept","parentId":7,"message":"not-an-object"}'
  ].join('\n'));

  assert.deepEqual(result.records.map(({ id, parentId, parentIdWasInvalid, content }) => ({ id, parentId, parentIdWasInvalid, content })), [
    { id: 'kept', parentId: null, parentIdWasInvalid: true, content: [] }
  ]);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'unsupported-entry', line: 2 },
    { code: 'unsupported-entry', line: 3 },
    { code: 'unsupported-entry', line: 3 }
  ]);
});

test('caps diagnostic output and skips a huge single-line record without retaining it', () => {
  const huge = `{"type":"message","id":"huge","parentId":null,"message":{"role":"assistant","content":"${'x'.repeat(DEFAULT_PARSE_LIMITS.maxRecordBytes + 1)}"}}`;
  const malformed = Array.from({ length: MAX_DIAGNOSTICS + 20 }, () => '{').join('\n');
  const result = parse([header, huge, malformed, second].join('\n'));

  assert.deepEqual(result.records.map((entry) => entry.id), ['two']);
  assert.equal(result.diagnostics.length, MAX_DIAGNOSTICS);
  assert.deepEqual(result.diagnostics.at(-1), {
    code: 'diagnostic-limit',
    severity: 'warning',
    message: 'Additional diagnostics were omitted by the preview limit.',
    detail: { count: 23, limit: MAX_DIAGNOSTICS }
  });
});

test('preserves all omitted counts when framing and semantic diagnostic buckets both overflow', () => {
  const malformed = Array.from({ length: 120 }, () => '{');
  const invalidEntries = Array.from({ length: 120 }, (_, index) => `{"type":null,"id":"invalid-${index}","parentId":null}`);
  const result = parse([header, ...malformed, ...invalidEntries].join('\n'));

  assert.equal(result.diagnostics.length, MAX_DIAGNOSTICS);
  assert.deepEqual(result.diagnostics.at(-1), {
    code: 'diagnostic-limit',
    severity: 'warning',
    message: 'Additional diagnostics were omitted by the preview limit.',
    detail: { count: 141, limit: MAX_DIAGNOSTICS }
  });
});

test('replaces malformed UTF-8 and contains it as a line diagnostic rather than throwing', () => {
  const prefix = new TextEncoder().encode(`${header}\n`);
  const bytes = new Uint8Array([...prefix, 0xff, 0xfe, 0xfd]);
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: 'malformed-utf8.jsonl', limits: DEFAULT_PARSE_LIMITS });

  assert.deepEqual(bytes, before);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'invalid-json', line: 2 }]);
});
