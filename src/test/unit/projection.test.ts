import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';

function parse(lines: readonly string[]) {
  return parsePiSession({
    bytes: new TextEncoder().encode(lines.join('\n')),
    uriLabel: 'projection.jsonl',
    limits: DEFAULT_PARSE_LIMITS
  });
}

const header = '{"type":"session","version":3,"id":"projection"}';

test('infers Pi-compatible physical-last active path, preserves root-to-leaf order, and reports alternate branches', () => {
  const result = parse([
    header,
    '{"type":"message","id":"root","parentId":null,"message":{"role":"user","content":"start"}}',
    '{"type":"message","id":"alternate","parentId":"root","message":{"role":"user","content":"other branch"}}',
    '{"type":"message","id":"main","parentId":"root","message":{"role":"assistant","content":"answer"}}',
    '{"type":"label","id":"leaf","parentId":"main","label":"latest"}'
  ]);

  assert.deepEqual(result.model.activePathIds, ['root', 'main', 'leaf']);
  assert.equal(result.model.summary.activeLeafId, 'leaf');
  assert.deepEqual(result.model.items.map((item) => item.sourceId), ['root', 'main', 'leaf']);
  assert.equal(result.model.items[2]?.metadata?.alternateBranchCount, 1);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'missing-parent'), false);
});

test('keeps orphan roots and deterministically severs parent cycles with diagnostics', () => {
  const missing = parse([
    header,
    '{"type":"message","id":"orphan","parentId":"gone","message":{"role":"user","content":"kept"}}'
  ]);
  assert.deepEqual(missing.model.activePathIds, ['orphan']);
  assert.deepEqual(missing.diagnostics.map((diagnostic) => diagnostic.code), ['missing-parent']);

  const cycle = parse([
    header,
    '{"type":"message","id":"a","parentId":"b","message":{"role":"user","content":"a"}}',
    '{"type":"message","id":"b","parentId":"a","message":{"role":"assistant","content":"b"}}'
  ]);
  assert.deepEqual(cycle.model.activePathIds, ['a', 'b']);
  assert.deepEqual(cycle.diagnostics.map(({ code, line }) => ({ code, line })), [{ code: 'cycle', line: 2 }]);
});

test('preserves interleaved assistant content and pairs results only by active-path toolCallId', () => {
  const result = parse([
    header,
    '{"type":"message","id":"user","parentId":null,"message":{"role":"user","content":"question"}}',
    '{"type":"message","id":"assistant","parentId":"user","message":{"role":"assistant","content":[{"type":"text","text":"before"},{"type":"toolCall","id":"call-1","name":"first","arguments":{"a":1}},{"type":"thinking","thinking":"consider"},{"type":"toolCall","id":"call-2","name":"second","arguments":{"b":2}},{"type":"text","text":"after"}]}}',
    '{"type":"message","id":"first-result","parentId":"assistant","message":{"role":"toolResult","toolCallId":"call-1","toolName":"first","content":"first output"}}',
    '{"type":"message","id":"second-result","parentId":"first-result","message":{"role":"toolResult","toolCallId":"call-2","toolName":"second","content":"second output","isError":true}}'
  ]);

  assert.deepEqual(result.model.items.map((item) => ({ kind: item.kind, key: item.key })), [
    { kind: 'user', key: 'user:entry' },
    { kind: 'assistant', key: 'assistant:assistant:0' },
    { kind: 'tool', key: 'assistant:tool:1' },
    { kind: 'assistant', key: 'assistant:assistant:1' },
    { kind: 'tool', key: 'assistant:tool:3' },
    { kind: 'assistant', key: 'assistant:assistant:2' }
  ]);
  assert.deepEqual(result.model.items[2]?.tool, {
    callId: 'call-1', name: 'first', argumentsText: '{"a":1}', resultText: 'first output'
  });
  assert.deepEqual(result.model.items[4]?.tool, {
    callId: 'call-2', name: 'second', argumentsText: '{"b":2}', resultText: 'second output', isError: true
  });
  assert.deepEqual(result.model.items[3]?.blocks, [{ kind: 'thinking', text: 'consider' }]);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'unmatched-tool-result'), false);
});

test('does not attach one result to duplicate or ID-less tool calls', () => {
  const result = parse([
    header,
    '{"type":"message","id":"user","parentId":null,"message":{"role":"user","content":"question"}}',
    '{"type":"message","id":"assistant","parentId":"user","message":{"role":"assistant","content":[{"type":"toolCall","id":"same","name":"one"},{"type":"toolCall","id":"same","name":"two"},{"type":"toolCall","name":"no-id"}]}}',
    '{"type":"message","id":"result","parentId":"assistant","message":{"role":"toolResult","toolCallId":"same","content":"must not attach"}}'
  ]);

  const calls = result.model.items.filter((item) => item.sourceId === 'assistant' && item.kind === 'tool');
  assert.deepEqual(calls.map((item) => item.tool?.resultText), [undefined, undefined, undefined]);
  assert.deepEqual(result.model.items.at(-1)?.tool, {
    callId: 'same', name: 'Unknown tool', resultText: 'must not attach', unmatchedResult: true
  });
  assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.code), [
    'unsupported-entry', 'unsupported-entry', 'unmatched-tool-result'
  ]);
});

test('represents orphan tool results and retains compaction, visible custom, metadata, and escaped unknown notices', () => {
  const result = parse([
    header,
    '{"type":"message","id":"root","parentId":null,"message":{"role":"user","content":"start"}}',
    '{"type":"compaction","id":"compact","parentId":"root","summary":"summary","firstKeptEntryId":"root","tokensBefore":12}',
    '{"type":"custom_message","id":"visible","parentId":"compact","customType":"notice","display":true,"content":"show"}',
    '{"type":"custom_message","id":"hidden","parentId":"visible","customType":"notice","display":false,"content":"hide"}',
    '{"type":"model_change","id":"model","parentId":"hidden","provider":"acme","modelId":"model"}',
    '{"type":"<script>","id":"unknown","parentId":"model","content":"opaque"}',
    '{"type":"session_info","id":"info","parentId":"unknown","name":"named"}',
    '{"type":"message","id":"orphan","parentId":"info","message":{"role":"toolResult","toolCallId":"missing","toolName":"lost","content":"output"}}'
  ]);

  assert.equal(result.model.summary.hiddenCustomCount, 1);
  assert.equal(result.model.summary.name, 'named');
  assert.deepEqual(result.model.items.map((item) => item.kind), [
    'user', 'compaction', 'customMessage', 'modelChange', 'unknown', 'sessionInfo', 'tool'
  ]);
  assert.deepEqual({ ...result.model.items[1]?.metadata }, { firstKeptEntryId: 'root', tokensBefore: 12 });
  assert.equal(result.model.items[4]?.title, 'Unknown entry: &lt;script&gt;');
  assert.deepEqual(result.model.items[6]?.tool, {
    callId: 'missing', name: 'lost', resultText: 'output', unmatchedResult: true
  });
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'unmatched-tool-result'));
});
