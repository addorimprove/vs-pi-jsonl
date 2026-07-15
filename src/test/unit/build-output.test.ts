import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const requiredOutputs = [
  'dist/extension/constants.js',
  'dist/extension/commands.js',
  'dist/extension/extension.js',
  'dist/extension/protocol.js',
  'dist/extension/provider.js',
  'dist/extension/webview-html.js',
  'media/main.js'
];

test('build emits the extension modules and browser webview bundle', () => {
  for (const output of requiredOutputs) {
    assert.equal(existsSync(resolve(process.cwd(), output)), true, `missing ${output}`);
  }

  const webviewBundle = readFileSync(resolve(process.cwd(), 'media/main.js'), 'utf8');
  assert.match(webviewBundle, /acquireVsCodeApi/);
  assert.doesNotMatch(webviewBundle, /fetch\(|XMLHttpRequest|WebSocket|EventSource/);
});

test('provider uses the text-document custom-editor lifecycle, scoped listeners, and no write path', () => {
  const provider = readFileSync(resolve(process.cwd(), 'dist/extension/provider.js'), 'utf8');

  assert.match(provider, /resolveCustomTextEditor/);
  assert.match(provider, /localResourceRoots: \[mediaRoot\]/);
  assert.match(provider, /subscriptions\.splice\(0\)/);
  assert.match(provider, /workspace\.onDidChangeTextDocument/);
  assert.match(provider, /requestId \+= 1/);
  assert.match(provider, /let ready = false/);
  assert(provider.indexOf('webviewPanel.onDidDispose') < provider.indexOf('beginRead(nextRevision)'), 'panel disposal must be registered before the initial read');
  assert.match(provider, /uri\.scheme !== 'file'/);
  assert.doesNotMatch(provider, /writeFile|saveCustomDocument|workspace\.fs\.writeFile|WorkspaceEdit/);
});
