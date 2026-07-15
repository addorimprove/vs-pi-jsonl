import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

interface Manifest {
  activationEvents: string[];
  configurationDefaults?: unknown;
  contributes: {
    commands: Array<{ command: string; title: string; icon: string }>;
    customEditors: Array<{
      viewType: string;
      displayName: string;
      selector: Array<{ filenamePattern: string }>;
      priority: string;
    }>;
    menus: { 'editor/title': Array<{ command: string; when: string; group: string }> };
  };
}

const OPEN_PREVIEW = 'piSessionPreview.openPreview';
const OPEN_SOURCE = 'piSessionPreview.openSource';
const VIEW_TYPE = 'piSessionPreview.preview';

test('manifest offers an option-priority JSONL preview without an association override', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  ) as Manifest;

  assert.deepEqual(manifest.contributes.customEditors, [{
    viewType: VIEW_TYPE,
    displayName: 'Pi Session Preview',
    selector: [{ filenamePattern: '*.jsonl' }],
    priority: 'option'
  }]);
  assert.equal(manifest.configurationDefaults, undefined);
});

test('manifest registers title-bar toggle commands with constrained visibility', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')
  ) as Manifest;
  const commands = manifest.contributes.commands;

  assert.deepEqual(commands, [
    { command: OPEN_PREVIEW, title: 'Open Pi Session Preview', icon: '$(preview)' },
    { command: OPEN_SOURCE, title: 'Open JSONL Source', icon: '$(code)' }
  ]);
  assert.deepEqual(manifest.contributes.menus['editor/title'], [
    {
      command: OPEN_PREVIEW,
      when: 'resourceExtname == .jsonl && activeEditor == workbench.editors.textEditor',
      group: 'navigation@10'
    },
    {
      command: OPEN_SOURCE,
      when: `activeCustomEditorId == ${VIEW_TYPE}`,
      group: 'navigation@10'
    }
  ]);
  assert.deepEqual(manifest.activationEvents, [
    `onCustomEditor:${VIEW_TYPE}`,
    `onCommand:${OPEN_PREVIEW}`,
    `onCommand:${OPEN_SOURCE}`
  ]);
});
