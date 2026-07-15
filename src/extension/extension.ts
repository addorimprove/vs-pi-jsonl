import * as vscode from 'vscode';

import { registerPreviewCommands } from './commands.js';
import { VIEW_TYPE } from './constants.js';
import {
  PiSessionPreviewProvider,
  type PreviewProviderObserver
} from './provider.js';
import type { ExtensionToWebview } from './protocol.js';

export interface PreviewIntegrationEvent {
  readonly type: 'post' | 'dispose';
  readonly uri: string;
  readonly panelId: number;
  readonly message?: ExtensionToWebview;
}

/** Only returned from an Extension Development Host; production exposes no observation API. */
export interface PreviewIntegrationProbe {
  events(): readonly PreviewIntegrationEvent[];
  clear(): void;
}

export function activate(context: vscode.ExtensionContext): PreviewIntegrationProbe | undefined {
  const probe = createDevelopmentProbe(context);
  const provider = new PiSessionPreviewProvider(context.extensionUri, probe?.observer);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: {
        retainContextWhenHidden: false
      }
    }),
    ...registerPreviewCommands({
      register: (command, callback) => vscode.commands.registerCommand(command, callback),
      activeTextEditor: () => vscode.window.activeTextEditor,
      activeTab: () => vscode.window.tabGroups.activeTabGroup.activeTab?.input,
      isPreviewInput: (input): input is vscode.TabInputCustom => input instanceof vscode.TabInputCustom,
      activeViewColumn: () => vscode.window.tabGroups.activeTabGroup.viewColumn,
      openWith: (uri, viewType, options) => vscode.commands.executeCommand(
        'vscode.openWith',
        uri,
        viewType,
        options
      )
    })
  );

  return probe?.api;
}

function createDevelopmentProbe(context: vscode.ExtensionContext): { observer: PreviewProviderObserver; api: PreviewIntegrationProbe } | undefined {
  if (context.extensionMode !== vscode.ExtensionMode.Development && context.extensionMode !== vscode.ExtensionMode.Test) {
    return undefined;
  }
  const recorded: PreviewIntegrationEvent[] = [];
  const observer: PreviewProviderObserver = {
    post: (uri, panelId, message): void => {
      recorded.push(Object.freeze({ type: 'post', uri: uri.toString(), panelId, message }));
    },
    dispose: (uri, panelId): void => {
      recorded.push(Object.freeze({ type: 'dispose', uri: uri.toString(), panelId }));
    }
  };
  return {
    observer,
    api: Object.freeze({
      events: (): readonly PreviewIntegrationEvent[] => recorded.slice(),
      clear: (): void => { recorded.splice(0); }
    })
  };
}

export function deactivate(): void {
  // No background resources or Pi runtime are started by this extension.
}
