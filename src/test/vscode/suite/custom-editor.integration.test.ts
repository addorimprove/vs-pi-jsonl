import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { OPEN_PREVIEW, OPEN_SOURCE, VIEW_TYPE } from '../../../extension/constants.js';
import type {
  PreviewIntegrationEvent,
  PreviewIntegrationProbe
} from '../../../extension/extension.js';

type InitEvent = PreviewIntegrationEvent & {
  readonly type: 'post';
  readonly message: Extract<NonNullable<PreviewIntegrationEvent['message']>, { readonly type: 'init' }>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const workspaceRoot = requireWorkspaceRoot();

suite('Pi Session Preview custom editor', () => {
  let probe: PreviewIntegrationProbe;
  const temporaryUris: vscode.Uri[] = [];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<PreviewIntegrationProbe>('rajan.pi-session-preview');
    assert(extension !== undefined, 'Pi Session Preview extension must be discoverable.');
    probe = await extension.activate();
    assert(probe !== undefined, 'Development activation must expose the local integration probe.');
  });

  teardown(async () => {
    await closeTabsFor(temporaryUris);
    for (const uri of temporaryUris.splice(0)) {
      try {
        await vscode.workspace.fs.delete(uri, { useTrash: false });
      } catch {
        // Best-effort cleanup must not hide an integration assertion failure.
      }
    }
    probe.clear();
  });

  test('registers the real provider and title commands for same-group raw, preview, source, and Open With fallback', async () => {
    const uri = await createSession('title-toggle');
    const source = await showSource(uri, vscode.ViewColumn.One);
    const viewColumn = source.viewColumn;

    const registered = await vscode.commands.getCommands(true);
    assert(registered.includes(OPEN_PREVIEW), 'the raw editor-title command is registered');
    assert(registered.includes(OPEN_SOURCE), 'the preview editor-title command is registered');

    probe.clear();
    await vscode.commands.executeCommand(OPEN_PREVIEW);
    await waitFor(() => activeInputIsPreview(uri));
    const initial = await waitForInit(uri);
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, viewColumn);
    assert.equal(textIn(initial).includes('title-toggle'), true, 'the registered provider parsed the supplied document');

    await vscode.commands.executeCommand(OPEN_SOURCE);
    await waitFor(() => activeInputIsSource(uri));
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, viewColumn);

    // This is the public command path used by Open With/Reopen Editor With.
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
      viewColumn,
      preserveFocus: false
    });
    await waitFor(() => activeInputIsPreview(uri));
    assert.equal(vscode.window.tabGroups.activeTabGroup.viewColumn, viewColumn);
  });

  test('keeps unsaved raw edits in memory and never writes preview data back to the source file', async () => {
    const original = sessionText('on-disk-original');
    const dirty = sessionText('unsaved-raw-sentinel');
    const uri = await createFile(original);
    const editor = await showSource(uri, vscode.ViewColumn.One);
    const document = editor.document;

    const changed = await editor.edit((builder) => builder.replace(fullRange(document), dirty));
    assert.equal(changed, true);
    assert.equal(document.isDirty, true);
    assert.equal(decoder.decode(await vscode.workspace.fs.readFile(uri)), original, 'the dirty source buffer has not been saved');

    probe.clear();
    await vscode.commands.executeCommand(OPEN_PREVIEW);
    await waitFor(() => activeInputIsPreview(uri));
    const snapshot = await waitForInit(uri, (event) => textIn(event).includes('unsaved-raw-sentinel'));
    assert.equal(textIn(snapshot).includes('on-disk-original'), false);
    assert.equal(document.isDirty, true, 'opening the custom editor does not save or mutate the raw editor');
    assert.equal(decoder.decode(await vscode.workspace.fs.readFile(uri)), original, 'the provider did not write the source URI');

    await vscode.commands.executeCommand(OPEN_SOURCE);
    await waitFor(() => activeInputIsSource(uri));
    assert.equal(vscode.window.activeTextEditor?.document.getText(), dirty);
    assert.equal(vscode.window.activeTextEditor?.document.isDirty, true);
  });

  test('refreshes real external appends, recovers malformed live tails, and reports unsupported JSONL as a controlled state', async () => {
    const uri = await createSession('initial-live-content');
    await showSource(uri, vscode.ViewColumn.One);
    probe.clear();
    await vscode.commands.executeCommand(OPEN_PREVIEW);
    await waitForInit(uri, (event) => textIn(event).includes('initial-live-content'));

    probe.clear();
    const appended = `${sessionText('initial-live-content')}\n${messageLine('external-append-sentinel', 'external-append-sentinel', 'integration-user')}`;
    await write(uri, appended);
    const live = await waitForInit(uri, (event) => textIn(event).includes('external-append-sentinel'));
    assert.equal(decoder.decode(await vscode.workspace.fs.readFile(uri)), appended, 'refresh reads without rewriting the externally changed source');
    assert.equal(textIn(live).includes('initial-live-content'), true);

    probe.clear();
    const malformedTail = `${appended}\n{"type":`;
    await write(uri, malformedTail);
    const recovered = await waitForInit(uri, (event) => event.message.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-json'));
    assert.equal(textIn(recovered).includes('external-append-sentinel'), true, 'valid neighboring entries survive a malformed live tail');
    assert.equal(decoder.decode(await vscode.workspace.fs.readFile(uri)), malformedTail, 'malformed input remains byte-for-byte as supplied');

    const unsupported = await createFile('{"not":"a Pi header"}\n');
    await showSource(unsupported, vscode.ViewColumn.One);
    probe.clear();
    await vscode.commands.executeCommand(OPEN_PREVIEW);
    const unsupportedState = await waitForInit(unsupported, (event) => event.message.diagnostics.some((diagnostic) => diagnostic.code === 'unsupported-format'));
    assert.equal(unsupportedState.message.page.total, 0);
    assert.equal(unsupportedState.message.diagnostics.some((diagnostic) => diagnostic.severity === 'error'), true);
  });

  test('admits a 20 MiB many-turn session in the real extension host without an unbounded page', async () => {
    const uri = await createFile(largeSessionText(20 * 1024 * 1024, 10_000));
    await showSource(uri, vscode.ViewColumn.One);
    probe.clear();
    const started = Date.now();
    await vscode.commands.executeCommand(OPEN_PREVIEW);
    const initial = await waitForInit(uri, (event) => event.message.page.total === 10_000);
    const elapsed = Date.now() - started;

    assert.equal(initial.message.page.items.length, 50);
    assert.equal(initial.message.diagnostics.length <= 100, true);
    assert(elapsed < 2_000, `20 MiB provider-to-webview initialization took ${elapsed} ms.`);
  });

  test('coalesces rapid revisions to the newest source and isolates a surviving split preview after the other panel is disposed', async () => {
    const uri = await createSession('split-original');
    await showSource(uri, vscode.ViewColumn.One);
    probe.clear();
    await vscode.commands.executeCommand(OPEN_PREVIEW);
    const first = await waitForInit(uri, (event) => textIn(event).includes('split-original'));

    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: false
    });
    await waitFor(() => previewTabs(uri).length === 2);
    const second = await waitForInit(uri, (event) => event.panelId !== first.panelId);
    assert.notEqual(first.panelId, second.panelId, 'each split has a distinct real webview panel');

    const firstTab = previewTabs(uri).find((entry) => entry.group.viewColumn === vscode.ViewColumn.One)?.tab;
    assert(firstTab !== undefined, 'the first split contains the original preview');
    await vscode.window.tabGroups.close(firstTab, true);
    await waitFor(() => probe.events().some((event) => event.type === 'dispose' && event.panelId === first.panelId));

    probe.clear();
    const final = sessionText('stale-revision-final-sentinel');
    // Multiple writes inside the 250 ms debounce window must not publish an older snapshot.
    await write(uri, sessionText('stale-revision-one'));
    await delay(40);
    await write(uri, sessionText('stale-revision-two'));
    await delay(40);
    await write(uri, final);
    const survivor = await waitForInit(uri, (event) => event.panelId === second.panelId && textIn(event).includes('stale-revision-final-sentinel'));
    const afterWrites = probe.events().filter((event): event is InitEvent => isInit(event) && event.uri === uri.toString());

    assert.equal(textIn(survivor).includes('stale-revision-one'), false);
    assert.equal(textIn(survivor).includes('stale-revision-two'), false);
    assert.equal(afterWrites.some((event) => event.panelId === first.panelId), false, 'a disposed panel cannot publish after a later file event');
    assert.equal(afterWrites.every((event) => textIn(event).includes('stale-revision-final-sentinel')), true, 'superseded revisions never publish stale contents');
    assert.equal(decoder.decode(await vscode.workspace.fs.readFile(uri)), final, 'the provider remains read-only during rapid refreshes');
  });

  async function createSession(text: string): Promise<vscode.Uri> {
    return createFile(sessionText(text));
  }

  async function createFile(contents: string): Promise<vscode.Uri> {
    const uri = vscode.Uri.file(join(workspaceRoot, `.pi-session-preview-${randomUUID()}.jsonl`));
    temporaryUris.push(uri);
    await write(uri, contents);
    return uri;
  }
});

function requireWorkspaceRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root === undefined) {
    throw new Error('The Extension Development Host must open the fixture workspace.');
  }
  return root;
}

function sessionText(text: string): string {
  return [
    '{"type":"session","version":3,"id":"integration-session","cwd":"/synthetic"}',
    messageLine('integration-user', text)
  ].join('\n');
}

function largeSessionText(targetBytes: number, entries: number): string {
  const lines = ['{"type":"session","version":3,"id":"large-integration-session"}'];
  let bytesUsed = Buffer.byteLength(lines[0] ?? '');
  let parentId: string | null = null;
  for (let index = 0; index < entries; index += 1) {
    const id = `large-turn-${index}`;
    const base = messageLine(id, '', parentId);
    const remaining = targetBytes - bytesUsed;
    const payloadBytes = index === entries - 1
      ? remaining - 1 - Buffer.byteLength(base)
      : Math.floor(remaining / (entries - index)) - 1 - Buffer.byteLength(base);
    assert(payloadBytes >= 0);
    const line = messageLine(id, 'x'.repeat(payloadBytes), parentId);
    lines.push(line);
    bytesUsed += 1 + Buffer.byteLength(line);
    parentId = id;
  }
  const text = lines.join('\n');
  assert.equal(Buffer.byteLength(text), targetBytes);
  return text;
}

function messageLine(id: string, text: string, parentId: string | null = null): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    message: { role: 'user', content: text }
  });
}

async function write(uri: vscode.Uri, contents: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, encoder.encode(contents));
}

async function showSource(uri: vscode.Uri, viewColumn: vscode.ViewColumn): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document, { viewColumn, preview: false, preserveFocus: false });
}

function fullRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
}

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

function previewTabs(uri: vscode.Uri): Array<{ group: vscode.TabGroup; tab: vscode.Tab }> {
  const tabs: Array<{ group: vscode.TabGroup; tab: vscode.Tab }> = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom && input.uri.toString() === uri.toString() && input.viewType === VIEW_TYPE) {
        tabs.push({ group, tab });
      }
    }
  }
  return tabs;
}

function isInit(event: PreviewIntegrationEvent): event is InitEvent {
  return event.type === 'post' && event.message?.type === 'init';
}

function textIn(event: InitEvent): string {
  return event.message.page.items.flatMap((item) => item.blocks ?? []).map((block) => block.text).join('\n');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the custom-editor transition.');
    }
    await delay(50);
  }
}

async function waitForInit(uri: vscode.Uri, predicate: (event: InitEvent) => boolean = () => true): Promise<InitEvent> {
  let found: InitEvent | undefined;
  await waitFor(() => {
    found = vscode.extensions.getExtension<PreviewIntegrationProbe>('rajan.pi-session-preview')?.exports
      ?.events()
      .find((event): event is InitEvent => isInit(event) && event.uri === uri.toString() && predicate(event));
    return found !== undefined;
  });
  assert(found !== undefined);
  return found;
}

async function closeTabsFor(uris: readonly vscode.Uri[]): Promise<void> {
  const sourceUris = new Set(uris.map((uri) => uri.toString()));
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs.filter((tab) => {
    const input = tab.input;
    return (input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom)
      && sourceUris.has(input.uri.toString());
  }));
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs, true);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
