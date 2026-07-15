import assert from 'node:assert/strict';
import test from 'node:test';
import type * as vscode from 'vscode';

import { registerPreviewCommands, type PreviewCommandApi } from '../../extension/commands.js';
import { OPEN_PREVIEW, OPEN_SOURCE, VIEW_TYPE } from '../../extension/constants.js';

test('title commands register reversible same-group Open With transitions', async () => {
  const commands = new Map<string, () => Promise<void>>();
  const openWithCalls: Array<{ uri: unknown; viewType: string; options: unknown }> = [];
  const rawUri = { path: '/sessions/example.JSONL' } as vscode.Uri;
  const previewInput: { uri: vscode.Uri; viewType: string } = { uri: rawUri, viewType: VIEW_TYPE };

  const api: PreviewCommandApi = {
    register(command, callback) {
      commands.set(command, callback);
      return { dispose() {} };
    },
    activeTextEditor: () => ({
      document: { uri: rawUri },
      viewColumn: 2 as never
    }),
    activeTab: () => previewInput,
    isPreviewInput: (input): input is typeof previewInput => input === previewInput,
    activeViewColumn: () => 2 as never,
    openWith: async (uri, viewType, options) => {
      openWithCalls.push({ uri, viewType, options });
    }
  };

  const disposables = registerPreviewCommands(api);
  assert.equal(disposables.length, 2);
  assert.deepEqual([...commands.keys()].sort(), [OPEN_PREVIEW, OPEN_SOURCE].sort());

  await commands.get(OPEN_PREVIEW)?.();
  await commands.get(OPEN_SOURCE)?.();

  assert.deepEqual(openWithCalls, [
    {
      uri: rawUri,
      viewType: VIEW_TYPE,
      options: { viewColumn: 2, preserveFocus: false }
    },
    {
      uri: rawUri,
      viewType: 'default',
      options: { viewColumn: 2, preserveFocus: false }
    }
  ]);
});

test('title commands are inert outside their supported editors', async () => {
  const commands = new Map<string, () => Promise<void>>();
  let opened = false;

  registerPreviewCommands({
    register(command, callback) {
      commands.set(command, callback);
      return { dispose() {} };
    },
    activeTextEditor: () => ({
      document: { uri: { path: '/sessions/example.txt' } as never },
      viewColumn: 1 as never
    }),
    activeTab: () => ({ viewType: VIEW_TYPE }),
    isPreviewInput: (input: unknown): input is never => {
      void input;
      return false;
    },
    activeViewColumn: () => 1 as never,
    openWith: async () => {
      opened = true;
    }
  });

  await commands.get(OPEN_PREVIEW)?.();
  await commands.get(OPEN_SOURCE)?.();
  assert.equal(opened, false);
});
