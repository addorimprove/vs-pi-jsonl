import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('webview renderer has no network APIs, unsafe HTML sinks, or URI activation path', () => {
  const html = readFileSync(resolve(process.cwd(), 'src/extension/webview-html.ts'), 'utf8');
  const webview = readFileSync(resolve(process.cwd(), 'src/webview/main.ts'), 'utf8');

  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML|fetch\(/);
  assert.doesNotMatch(webview, /innerHTML|insertAdjacentHTML|eval\(|Function\(|fetch\(|XMLHttpRequest|WebSocket|EventSource/);
  assert.doesNotMatch(webview, /\.href\s*=|command:/);
  assert.match(webview, /createTextNode/);
  assert.match(webview, /type: 'requestPage'/);
  assert.match(webview, /thinking-text/);
  assert.match(webview, /compaction-collapsed/);
  assert.match(webview, /link omitted/);
});
