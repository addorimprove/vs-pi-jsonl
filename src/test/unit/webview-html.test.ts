import assert from 'node:assert/strict';
import test from 'node:test';

import { createPreviewHtml } from '../../extension/webview-html.js';

const uri = (value: string) => ({ toString: () => value }) as never;

test('preview webview has extension-only assets and restrictive no-network CSP', () => {
  const html = createPreviewHtml(
    { cspSource: 'vscode-webview://scaffold' } as never,
    uri('vscode-webview://scaffold/media/main.js'),
    uri('vscode-webview://scaffold/media/main.css')
  );

  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src 'none'/);
  assert.match(html, /style-src vscode-webview:\/\/scaffold/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /base-uri 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /frame-src 'none'/);
  assert.match(html, /worker-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|https?:\/\/|data:|blob:/i);
  assert.match(html, /href="vscode-webview:\/\/scaffold\/media\/main\.css"/);
  assert.match(html, /src="vscode-webview:\/\/scaffold\/media\/main\.js"/);

  const cspNonce = /script-src 'nonce-([^']+)'/.exec(html)?.[1];
  const scriptNonce = /<script nonce="([^"]+)"/.exec(html)?.[1];
  assert.ok(cspNonce);
  assert.equal(scriptNonce, cspNonce);
});
