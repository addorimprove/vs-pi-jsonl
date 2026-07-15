import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const vsix = resolve(process.cwd(), 'pi-session-preview.vsix');
const expectedContents = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/changelog.md',
  'extension/LICENSE.txt',
  'extension/THIRD-PARTY-NOTICES.md',
  'extension/package.json',
  'extension/readme.md',
  'extension/media/main.css',
  'extension/media/main.js',
  'extension/dist/core/index.js',
  'extension/dist/core/normalize.js',
  'extension/dist/core/parse.js',
  'extension/dist/core/schema.js',
  'extension/dist/extension/commands.js',
  'extension/dist/extension/constants.js',
  'extension/dist/extension/extension.js',
  'extension/dist/extension/protocol.js',
  'extension/dist/extension/provider.js',
  'extension/dist/extension/webview-html.js'
].sort();

test('VSIX contains only required runtime files and remains below the release size limit', () => {
  const contents = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();

  assert.deepEqual(contents, expectedContents);
  assert.ok(statSync(vsix).size <= 2 * 1024 * 1024, 'VSIX exceeds 2 MiB');
  assert.equal(contents.some((entry) => /node_modules|src\/|test\/|\.map$|pi\/|export/i.test(entry)), false);
});
