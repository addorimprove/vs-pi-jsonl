import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';

class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1_664_525) + 1_013_904_223) >>> 0;
    return this.state;
  }

  integer(maxExclusive: number): number {
    return this.next() % maxExclusive;
  }
}

function generatedBytes(seed: number): Uint8Array {
  const random = new SeededRandom(seed);
  const records: string[] = [];
  const lineCount = random.integer(8);
  const text = new TextEncoder();
  const candidates = [
    '{',
    '[]',
    'null',
    '"scalar"',
    '{"type":"session","version":3,"id":"synthetic"}',
    '{"type":"message","id":"entry","parentId":null,"message":{"role":"user"}}',
    '{"type":"message","id":null,"parentId":{},"message":{"role":null,"content":null}}',
    '{"type":"mystery","id":"unknown","parentId":null,"content":[{"type":"image","data":"synthetic"}]}',
    '{"type":"message","id":"deep","parentId":null,"message":{"role":"assistant","content":[{"type":"toolCall","id":"call","name":"tool","arguments":{"x":[1,2,3]}}]}}'
  ];
  for (let index = 0; index < lineCount; index += 1) {
    records.push(candidates[random.integer(candidates.length)] ?? '');
  }
  const prefix = random.integer(5) === 0 ? '\uFEFF' : '';
  const separator = random.integer(2) === 0 ? '\n' : '\r\n';
  const structured = text.encode(`${prefix}${records.join(separator)}${random.integer(4) === 0 ? separator : ''}`);
  const noiseLength = random.integer(64);
  const noisy = new Uint8Array(structured.length + noiseLength);
  noisy.set(structured);
  for (let index = structured.length; index < noisy.length; index += 1) {
    noisy[index] = random.integer(256);
  }
  return noisy;
}

function assertFrozenRecursively(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  assert(Object.isFrozen(value));
  for (const child of Object.values(value)) {
    assertFrozenRecursively(child);
  }
}

test('10,000 seeded hostile JSONL cases never throw, mutate input bytes, or return mutable output', () => {
  for (let seed = 0; seed < 10_000; seed += 1) {
    const bytes = generatedBytes(seed);
    const before = bytes.slice();
    let result: ReturnType<typeof parsePiSession> | undefined;

    assert.doesNotThrow(() => {
      result = parsePiSession({
        bytes,
        uriLabel: `seed-${seed}.jsonl`,
        limits: { ...DEFAULT_PARSE_LIMITS, maxRecordBytes: 1_024, maxStringChars: 256 }
      });
    }, `seed ${seed}`);
    assert.deepEqual(bytes, before, `parser mutated seed ${seed}`);
    assert(result !== undefined, `parser returned no result for seed ${seed}`);
    assert(result.source.bytesRead <= bytes.byteLength);
    assert(result.source.linesSeen <= DEFAULT_PARSE_LIMITS.maxLines);
    assert.equal(new Set(result.records.map((entry) => entry.id)).size, result.records.length);
    assertFrozenRecursively(result);
  }
});

test('parser results are deeply immutable and cannot be used to alter source-derived fixture data', () => {
  const bytes = new TextEncoder().encode([
    '{"type":"session","version":3,"id":"immutable"}',
    '{"type":"message","id":"entry","parentId":null,"message":{"role":"assistant","content":[{"type":"text","text":"original"}]}}'
  ].join('\n'));
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: 'immutable.jsonl', limits: DEFAULT_PARSE_LIMITS });
  const entry = result.records[0];
  const block = entry?.content[0];

  assertFrozenRecursively(result);
  assert.equal(Reflect.set(result as object, 'records', []), false);
  assert.equal(Reflect.set(entry as object, 'id', 'changed'), false);
  assert.equal(Reflect.set(block as object, 'text', 'changed'), false);
  assert.equal(Reflect.set(result.diagnostics as object, 'length', 0), false);
  assert.equal(entry?.id, 'entry');
  assert.equal(block?.text, 'original');
  assert.deepEqual(bytes, before);
});
