import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_PARSE_LIMITS, MAX_CONTENT_BLOCKS, parsePiSession } from '../../core/parse.js';

test('marks truncated content and records omitted image payload size without retaining media data', () => {
  const result = parsePiSession({
    bytes: new TextEncoder().encode([
      '{"type":"session","version":3,"id":"s"}',
      '{"type":"message","id":"one","parentId":null,"message":{"role":"assistant","content":[{"type":"text","text":"abcdef"},{"type":"thinking","thinking":"abcdef"},{"type":"toolCall","id":"call","name":"tool","arguments":{"long":"abcdef"}},{"type":"image","data":"abcdef","mimeType":"image/png"}]}}'
    ].join('\n')),
    uriLabel: 'limits.jsonl',
    limits: { ...DEFAULT_PARSE_LIMITS, maxStringChars: 3 }
  });

  const content = result.records[0]?.content;
  assert.deepEqual(content?.[0], { kind: 'text', text: 'abc', truncated: true });
  assert.deepEqual(content?.[1], { kind: 'thinking', text: 'abc', truncated: true });
  assert.equal(content?.[2]?.kind, 'toolCall');
  assert.equal(content?.[2]?.truncated, true);
  assert.equal(content?.[3]?.omitted?.reason, 'media-omitted');
  assert.equal(content?.[3]?.omitted?.originalSize, 6);
  assert.equal(JSON.stringify(result).includes('abcdef'), false);
});

test('bounds hostile content-block and tool-argument arrays before projection and serialization', () => {
  const blocks = Array.from({ length: 50_000 }, () => '');
  const argumentsValue = Array.from({ length: 50_000 }, () => 0);
  const result = parsePiSession({
    bytes: new TextEncoder().encode([
      '{"type":"session","version":3,"id":"s"}',
      JSON.stringify({
        type: 'message',
        id: 'one',
        parentId: null,
        message: {
          role: 'assistant',
          content: [
            ...blocks,
            { type: 'toolCall', id: 'call', name: 'tool', arguments: argumentsValue }
          ]
        }
      })
    ].join('\n')),
    uriLabel: 'hostile-cardinality.jsonl',
    limits: DEFAULT_PARSE_LIMITS
  });

  const content = result.records[0]?.content ?? [];
  assert.equal(content.length, MAX_CONTENT_BLOCKS);
  assert.deepEqual(content.at(-1)?.omitted, { reason: 'content-block-limit', originalSize: 50_001 });
  assert.equal(result.model.items[0]?.blocks?.length, MAX_CONTENT_BLOCKS);
  assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === 'content-block-limit'), true);

  const toolOnly = parsePiSession({
    bytes: new TextEncoder().encode([
      '{"type":"session","version":3,"id":"s"}',
      JSON.stringify({ type: 'message', id: 'tool', parentId: null, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'tool', arguments: argumentsValue }] } })
    ].join('\n')),
    uriLabel: 'hostile-arguments.jsonl',
    limits: DEFAULT_PARSE_LIMITS
  });
  const tool = toolOnly.records[0]?.content[0];
  assert.equal(tool?.kind, 'toolCall');
  assert.equal(tool?.truncated, true);
  assert.equal(typeof tool?.argumentsText, 'string');
  assert((tool?.argumentsText?.length ?? 16_002) <= 16_001);

  const resultLimited = parsePiSession({
    bytes: new TextEncoder().encode([
      '{"type":"session","version":3,"id":"s"}',
      '{"type":"message","id":"call","parentId":null,"message":{"role":"assistant","content":[{"type":"toolCall","id":"call","name":"tool","arguments":{}}]}}',
      `{"type":"message","id":"result","parentId":"call","message":{"role":"toolResult","toolCallId":"call","toolName":"tool","content":"${'x'.repeat(32_000)}"}}`
    ].join('\n')),
    uriLabel: 'large-tool-result.jsonl',
    limits: DEFAULT_PARSE_LIMITS
  });
  const paired = resultLimited.model.items.find((item) => item.kind === 'tool')?.tool;
  assert.equal(paired?.truncated, true);
  assert.equal(paired?.resultText?.length, 16_000);
});
