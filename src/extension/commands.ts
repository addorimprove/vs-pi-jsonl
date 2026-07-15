import type * as vscode from 'vscode';

import { OPEN_PREVIEW, OPEN_SOURCE, VIEW_TYPE } from './constants.js';

interface PreviewInput {
  readonly uri: vscode.Uri;
  readonly viewType: string;
}

interface ActiveEditor {
  readonly document: { readonly uri: vscode.Uri };
  readonly viewColumn: vscode.ViewColumn | undefined;
}

interface OpenWithOptions {
  readonly viewColumn: vscode.ViewColumn | undefined;
  readonly preserveFocus: false;
}

export interface PreviewCommandApi {
  register(command: string, callback: () => Promise<void>): vscode.Disposable;
  activeTextEditor(): ActiveEditor | undefined;
  activeTab(): unknown;
  isPreviewInput(input: unknown): input is PreviewInput;
  activeViewColumn(): vscode.ViewColumn | undefined;
  openWith(uri: vscode.Uri, viewType: string, options: OpenWithOptions): Thenable<unknown>;
}

/** Registers editor-title commands without changing a user's editor association. */
export function registerPreviewCommands(api: PreviewCommandApi): vscode.Disposable[] {
  return [
    api.register(OPEN_PREVIEW, async () => {
      const editor = api.activeTextEditor();
      if (editor === undefined || !editor.document.uri.path.toLowerCase().endsWith('.jsonl')) {
        return;
      }

      await api.openWith(editor.document.uri, VIEW_TYPE, {
        viewColumn: editor.viewColumn,
        preserveFocus: false
      });
    }),
    api.register(OPEN_SOURCE, async () => {
      const input = api.activeTab();
      if (!api.isPreviewInput(input) || input.viewType !== VIEW_TYPE) {
        return;
      }

      await api.openWith(input.uri, 'default', {
        viewColumn: api.activeViewColumn(),
        preserveFocus: false
      });
    })
  ];
}
