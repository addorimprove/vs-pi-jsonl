import assert from 'node:assert/strict';
import test from 'node:test';

import { adjacentPage, latestPage, parseWebviewMessage, pageAt } from '../../extension/protocol.js';
import type { NormalizedSessionModel, ViewItem } from '../../core/index.js';

const item = (index: number): ViewItem => ({
  key: `key-${index}`,
  sourceId: `source-${index}`,
  sourceLine: index + 1,
  kind: 'user',
  title: 'User',
  blocks: [{ kind: 'text', text: `message ${index}` }]
});

function model(count: number): NormalizedSessionModel {
  return {
    summary: { version: 3, pathItemCount: count, hiddenCustomCount: 0 },
    activePathIds: [],
    items: Array.from({ length: count }, (_, index) => item(index))
  };
}

test('paging starts at the bounded final page and adjacent navigation neither skips nor duplicates cards', () => {
  const session = model(123);
  const latest = latestPage(session);
  assert.equal(latest.start, 100);
  assert.equal(latest.items.length, 23);
  assert.equal(latest.hasOlder, true);
  assert.equal(latest.hasNewer, false);

  const middle = adjacentPage(session, latest, 'older');
  const oldest = adjacentPage(session, middle, 'older');
  assert.equal(middle.start, 50);
  assert.equal(oldest.start, 0);
  assert.deepEqual([oldest, middle, latest].flatMap((value) => value.items.map((entry) => entry.key)), Array.from({ length: 123 }, (_, index) => `key-${index}`));
  assert.equal(adjacentPage(session, oldest, 'newer').start, middle.start);
  assert.equal(adjacentPage(session, middle, 'newer').start, latest.start);
  assert.equal(pageAt(session, -1).start, 0);
  assert.equal(pageAt(session, 999).start, 100);
});

test('webview protocol rejects unknown fields, non-finite values, and malformed page requests', () => {
  assert.deepEqual(parseWebviewMessage({ protocol: 1, type: 'ready' }), { protocol: 1, type: 'ready' });
  assert.deepEqual(
    parseWebviewMessage({ protocol: 1, type: 'requestPage', revision: 4, direction: 'older', anchor: 50 }),
    { protocol: 1, type: 'requestPage', revision: 4, direction: 'older', anchor: 50 }
  );
  assert.equal(parseWebviewMessage({ protocol: 1, type: 'ready', extra: true }), undefined);
  assert.equal(parseWebviewMessage({ protocol: 1, type: 'requestPage', revision: Infinity, direction: 'older', anchor: 0 }), undefined);
  assert.equal(parseWebviewMessage({ protocol: 1, type: 'requestPage', revision: 1, direction: 'elsewhere', anchor: 0 }), undefined);
  assert.equal(parseWebviewMessage({ protocol: 1, type: 'announce', revision: 1, message: 'x'.repeat(161) }), undefined);
  const prototypeMessage = Object.create({ protocol: 1, type: 'ready' });
  assert.equal(parseWebviewMessage(prototypeMessage), undefined);
});
