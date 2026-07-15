import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';
import type { NormalizedSessionModel, ViewItem } from '../../core/schema.js';

const fixtureDirectory = join(process.cwd(), 'src', 'test', 'fixtures', 'projection');
const fixtureNames = ['linear-v1', 'active-branch-content', 'missing-parent', 'cycles'] as const;
const itemKeys = new Set(['key', 'sourceId', 'sourceLine', 'kind', 'timestamp', 'title', 'blocks', 'tool', 'metadata', 'omitted']);
const blockKeys = new Set(['kind', 'text', 'truncated']);
const toolKeys = new Set(['callId', 'name', 'argumentsText', 'resultText', 'isError', 'unmatchedResult', 'truncated']);
const omittedKeys = new Set(['reason', 'originalSize']);
const summaryKeys = new Set(['sessionId', 'version', 'name', 'cwd', 'activeLeafId', 'pathItemCount', 'hiddenCustomCount']);

type ExpectedProjection = {
  readonly model: NormalizedSessionModel;
  readonly diagnostics: readonly { readonly code: string; readonly line?: number }[];
};

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(fixtureDirectory, `${name}.jsonl`)));
}

function expected(name: string): ExpectedProjection {
  return JSON.parse(readFileSync(join(fixtureDirectory, `${name}.expected.json`), 'utf8')) as ExpectedProjection;
}

function parseFixture(name: string) {
  const bytes = fixture(name);
  const before = bytes.slice();
  const result = parsePiSession({ bytes, uriLabel: `${name}.jsonl`, limits: DEFAULT_PARSE_LIMITS });
  assert.deepEqual(bytes, before, `parser mutated projection fixture ${name}`);
  return result;
}

function serializableProjection(result: ReturnType<typeof parseFixture>): ExpectedProjection {
  return JSON.parse(JSON.stringify({
    model: result.model,
    diagnostics: result.diagnostics.map(({ code, line }) => line === undefined ? { code } : { code, line })
  })) as ExpectedProjection;
}

for (const name of fixtureNames) {
  test(`projects the readable ${name} fixture to its checked safe output`, () => {
    const result = parseFixture(name);
    assert.deepEqual(serializableProjection(result), expected(name));
    assertFrozenRecursively(result.model);
    assertBoundedDisplayModel(result.model);
  });
}

test('branch fixture proves physical-last selection, branch counting, semantic block order, and tool-result pairing', () => {
  const result = parseFixture('active-branch-content');
  const { model } = result;

  assert.deepEqual(model.activePathIds, [
    'root', 'main-user', 'assistant', 'matched-result', 'orphan-result', 'bash', 'compaction',
    'branch-summary', 'visible-custom', 'hidden-custom', 'model-change', 'thinking-change', 'unknown', 'active-label'
  ]);
  assert.equal(model.summary.activeLeafId, 'active-label');
  assert.equal(model.items.at(-1)?.metadata?.alternateBranchCount, 1);
  assert.equal(model.items.some((item) => item.sourceId === 'alternate-user'), false);
  assert.equal(model.items.some((item) => item.sourceId === 'alternate-assistant'), false);

  assert.deepEqual(model.items.filter((item) => item.sourceId === 'assistant').map((item) => item.key), [
    'assistant:assistant:0', 'assistant:tool:2', 'assistant:assistant:1', 'assistant:tool:4', 'assistant:assistant:2'
  ]);
  assert.deepEqual(model.items.filter((item) => item.sourceId === 'assistant').map((item) => item.blocks?.map((block) => `${block.kind}:${block.text}`) ?? item.tool?.resultText), [
    ['text:Before the first tool.', 'thinking:Consider the first call.'],
    'first result',
    ['text:Between calls.'],
    undefined,
    ['thinking:After both calls.', 'text:Final assistant text.']
  ]);
  assert.equal(model.items.find((item) => item.key === 'assistant:tool:2')?.tool?.unmatchedResult, undefined);
  assert.deepEqual(model.items.find((item) => item.key === 'orphan-result:orphan')?.tool, {
    callId: 'missing-call',
    name: 'missing_tool',
    resultText: 'orphan result',
    isError: true,
    unmatchedResult: true
  });
  assert.deepEqual(result.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'unmatched-tool-result', line: 8 }
  ]);
});

test('corrupted graph fixtures recover a physical-last orphan and deterministically sever self and multi-node cycles', () => {
  const missing = parseFixture('missing-parent');
  assert.deepEqual(missing.model.activePathIds, ['orphan']);
  assert.deepEqual(missing.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'missing-parent', line: 3 }]);

  const cycles = parseFixture('cycles');
  assert.deepEqual(cycles.model.activePathIds, ['a', 'c']);
  assert.equal(cycles.model.summary.activeLeafId, 'c');
  assert.deepEqual(cycles.diagnostics.map(({ code, line }) => ({ code, line })), [
    { code: 'cycle', line: 2 },
    { code: 'cycle', line: 3 }
  ]);
});

test('custom fixture output is inert bounded display data, not executable custom behavior', () => {
  const model = parseFixture('active-branch-content').model;
  const serialized = JSON.stringify(model);
  const visibleCustom = model.items.find((item) => item.sourceId === 'visible-custom');

  assert.deepEqual({ ...visibleCustom?.metadata }, { customType: 'notice', display: true });
  assert.match(visibleCustom?.blocks?.[0]?.text ?? '', /<button onclick="run\(\)">not behavior<\/button>/);
  for (const forbidden of ['"action"', '"nested"', 'not retained']) {
    assert.equal(serialized.includes(forbidden), false, `model retained custom behavior field ${forbidden}`);
  }
  assert.equal(serialized.includes('function'), false);
});

function assertBoundedDisplayModel(model: NormalizedSessionModel): void {
  assertOnlyKeys(model.summary, summaryKeys, 'summary');
  for (const value of Object.values(model.summary)) {
    assertSafeScalar(value, 'summary value');
  }
  for (const id of model.activePathIds) {
    assert.equal(typeof id, 'string');
    assert(id.length <= DEFAULT_PARSE_LIMITS.maxStringChars);
  }
  for (const item of model.items) {
    assertBoundedItem(item);
  }
}

function assertBoundedItem(item: ViewItem): void {
  assertOnlyKeys(item, itemKeys, `item ${item.key}`);
  assert.equal(typeof item.key, 'string');
  assert.equal(typeof item.sourceId, 'string');
  assert.equal(typeof item.sourceLine, 'number');
  assert.equal(typeof item.kind, 'string');
  if (item.title !== undefined) {
    assert.equal(typeof item.title, 'string');
    assert(item.title.length <= DEFAULT_PARSE_LIMITS.maxStringChars);
  }
  if (item.timestamp !== undefined) {
    assert.equal(typeof item.timestamp, 'string');
    assert(item.timestamp.length <= DEFAULT_PARSE_LIMITS.maxStringChars);
  }
  for (const block of item.blocks ?? []) {
    assertOnlyKeys(block, blockKeys, `block in ${item.key}`);
    assert.equal(typeof block.text, 'string');
    assert(block.text.length <= DEFAULT_PARSE_LIMITS.maxStringChars);
  }
  if (item.tool !== undefined) {
    assertOnlyKeys(item.tool, toolKeys, `tool in ${item.key}`);
    for (const value of Object.values(item.tool)) {
      assertSafeScalar(value, `tool value in ${item.key}`);
    }
  }
  if (item.metadata !== undefined) {
    for (const value of Object.values(item.metadata)) {
      assertSafeScalar(value, `metadata value in ${item.key}`);
    }
  }
  if (item.omitted !== undefined) {
    assertOnlyKeys(item.omitted, omittedKeys, `omission in ${item.key}`);
    assert.equal(typeof item.omitted.reason, 'string');
    if (item.omitted.originalSize !== undefined) {
      assert.equal(typeof item.omitted.originalSize, 'number');
      assert(Number.isFinite(item.omitted.originalSize));
    }
  }
}

function assertOnlyKeys(value: object, allowed: ReadonlySet<string>, label: string): void {
  for (const key of Object.keys(value)) {
    assert(allowed.has(key), `${label} exposed unsupported field ${key}`);
  }
}

function assertSafeScalar(value: unknown, label: string): void {
  assert(
    value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)),
    `${label} must be a finite scalar`
  );
}

function assertFrozenRecursively(value: unknown): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }
  assert(Object.isFrozen(value), 'projection result must be frozen');
  for (const child of Object.values(value)) {
    assertFrozenRecursively(child);
  }
}
