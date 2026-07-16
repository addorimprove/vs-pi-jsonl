import assert from 'node:assert/strict';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { OPEN_SOURCE, VIEW_TYPE } from '../../../extension/constants.js';

const fixtureUri = vscode.Uri.file(join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', 'session.jsonl'));

suite('Pi Session Preview Open With', () => {
  test('opens the option-priority preview and returns to source in the same editor group', async () => {
    const source = await vscode.workspace.openTextDocument(fixtureUri);
    const sourceEditor = await vscode.window.showTextDocument(source, {
      viewColumn: vscode.ViewColumn.One,
      preview: false,
      preserveFocus: false
    });
    const viewColumn = sourceEditor.viewColumn;

    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, VIEW_TYPE, {
      viewColumn,
      preserveFocus: false
    });
    await waitFor(() => activeInputIsPreview(fixtureUri));
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, viewColumn);

    await vscode.commands.executeCommand(OPEN_SOURCE);
    await waitFor(() => activeInputIsSource(fixtureUri));
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, viewColumn);

    // This exercises the supported fallback command used by Open/Reopen Editor With.
    await vscode.commands.executeCommand('vscode.openWith', fixtureUri, VIEW_TYPE, {
      viewColumn,
      preserveFocus: false
    });
    await waitFor(() => activeInputIsPreview(fixtureUri));

    const extension = vscode.extensions.getExtension('addorimprove.pi-session-preview');
    const editor = extension?.packageJSON?.contributes?.customEditors?.find(
      (candidate: { viewType?: unknown }) => candidate.viewType === VIEW_TYPE
    );
    assert.equal(editor?.priority, 'option', 'the fallback must remain option-priority rather than an association override');
  });
});

function activeInputIsPreview(uri: vscode.Uri): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom
    && input.uri.toString() === uri.toString()
    && input.viewType === VIEW_TYPE;
}

function activeInputIsSource(uri: vscode.Uri): boolean {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputText && input.uri.toString() === uri.toString();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the editor transition.');
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}
