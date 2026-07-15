import * as vscode from 'vscode';

import {
  DEFAULT_PARSE_LIMITS,
  parsePiSession,
  type Diagnostic,
  type NormalizedSessionModel,
  type ParseResult
} from '../core/index.js';
import {
  adjacentPage,
  latestPage,
  parseWebviewMessage,
  PUBLIC_LIMITS,
  type ExtensionToWebview,
  type Page
} from './protocol.js';
import { VIEW_TYPE } from './constants.js';
import { createPreviewHtml } from './webview-html.js';

interface PanelState {
  readonly revision: number;
  readonly model: NormalizedSessionModel;
  readonly diagnostics: readonly Diagnostic[];
  readonly page: Page;
}

/** Development-host-only observer; no command, message, or runtime behavior depends on it. */
export interface PreviewProviderObserver {
  post(uri: vscode.Uri, panelId: number, message: ExtensionToWebview): void;
  dispose(uri: vscode.Uri, panelId: number): void;
}

/** A read-only, URI-scoped Pi JSONL viewer; it never invokes Pi or writes source. */
export class PiSessionPreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = VIEW_TYPE;
  private nextPanelId = 0;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly observer?: PreviewProviderObserver
  ) {}

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    token: vscode.CancellationToken
  ): Promise<void> {
    const panelId = this.nextPanelId++;
    const mediaRoot = vscode.Uri.joinPath(this.extensionUri, 'media');
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaRoot]
    };

    const scriptUri = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.js'));
    const styleUri = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'main.css'));
    webviewPanel.webview.html = createPreviewHtml(webviewPanel.webview, scriptUri, styleUri);

    let disposed = false;
    let ready = false;
    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let requestId = 0;
    let nextRevision = 0;
    let state: PanelState | undefined;
    const subscriptions: vscode.Disposable[] = [];

    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      requestId += 1; // Supersede pending reads that cannot be physically aborted by vscode.workspace.fs.
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer);
        reloadTimer = undefined;
      }
      for (const subscription of subscriptions.splice(0)) {
        subscription.dispose();
      }
      this.observer?.dispose(document.uri, panelId);
    };
    subscriptions.push(webviewPanel.onDidDispose(dispose));
    subscriptions.push(token.onCancellationRequested(dispose));
    if (token.isCancellationRequested) {
      dispose();
      return;
    }

    const post = (message: ExtensionToWebview): void => {
      if (!disposed && ready) {
        void webviewPanel.webview.postMessage(message);
        this.observer?.post(document.uri, panelId, message);
      }
    };
    const postInit = (): void => {
      if (state === undefined) {
        return;
      }
      post({
        protocol: 1,
        type: 'init',
        revision: state.revision,
        summary: state.model.summary,
        diagnostics: state.diagnostics,
        page: state.page,
        limits: PUBLIC_LIMITS
      });
    };

    const beginRead = (revision: number): void => {
      const activeRequest = ++requestId;
      const isCurrent = (): boolean => !disposed
        && !token.isCancellationRequested
        && activeRequest === requestId;
      void this.readState(document, revision, isCurrent).then((next) => {
        if (next === undefined || !isCurrent()) {
          return;
        }
        state = next;
        postInit();
      });
    };
    const scheduleReload = (): void => {
      if (disposed || token.isCancellationRequested) {
        return;
      }
      requestId += 1;
      if (reloadTimer !== undefined) {
        clearTimeout(reloadTimer);
      }
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        beginRead(++nextRevision);
      }, 250);
    };

    const watchChange = (uri: vscode.Uri): void => {
      if (uri.toString() === document.uri.toString()) {
        scheduleReload();
      }
    };
    if (document.uri.scheme === 'file') {
      const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath, false, false, false);
      subscriptions.push(
        watcher,
        watcher.onDidChange(watchChange),
        watcher.onDidCreate(watchChange),
        watcher.onDidDelete(watchChange)
      );
    }
    subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        scheduleReload();
      }
    }));
    subscriptions.push(webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
      const message = parseWebviewMessage(raw);
      if (message === undefined || disposed) {
        return;
      }
      if (message.type === 'ready') {
        ready = true;
        postInit();
        return;
      }
      if (message.type === 'announce' || state === undefined) {
        // The webview owns its live region. This intentionally has no host-side action or logging.
        return;
      }
      if (message.revision !== state.revision || message.anchor !== state.page.start) {
        return;
      }
      state = { ...state, page: adjacentPage(state.model, state.page, message.direction) };
      post({ protocol: 1, type: 'page', revision: state.revision, page: state.page });
    }));

    beginRead(nextRevision);
  }

  private async readState(
    document: vscode.TextDocument,
    revision: number,
    isCurrent: () => boolean
  ): Promise<PanelState | undefined> {
    if (!isCurrent()) {
      return undefined;
    }
    if (document.uri.scheme !== 'file') {
      return this.emptyState(revision, 'read-failed', 'Pi Session Preview supports local files only. Return to the source editor to inspect this document.');
    }

    try {
      const bytes = document.isDirty
        ? encodeDirtyText(document.getText(), DEFAULT_PARSE_LIMITS.maxBytes)
        : await this.readFile(document.uri, isCurrent);
      if (bytes === undefined || !isCurrent()) {
        return undefined;
      }
      if (typeof bytes === 'number' || bytes.byteLength > DEFAULT_PARSE_LIMITS.maxBytes) {
        return this.emptyState(revision, 'byte-limit', `Content exceeds the ${formatBytes(DEFAULT_PARSE_LIMITS.maxBytes)} read limit; source was not loaded.`, typeof bytes === 'number' ? bytes : bytes.byteLength);
      }
      const result = parsePiSession({ bytes, uriLabel: document.uri.toString(), limits: DEFAULT_PARSE_LIMITS });
      if (!isCurrent()) {
        return undefined;
      }
      return result.header === undefined
        ? this.unsupportedFormatState(revision, result)
        : { revision, model: result.model, diagnostics: result.diagnostics, page: latestPage(result.model) };
    } catch {
      if (!isCurrent()) {
        return undefined;
      }
      return this.emptyState(revision, 'read-failed', 'The session file could not be read. Return to the source editor to inspect it.');
    }
  }

  private async readFile(uri: vscode.Uri, isCurrent: () => boolean): Promise<Uint8Array | number | undefined> {
    const stat = await vscode.workspace.fs.stat(uri);
    if (!isCurrent()) {
      return undefined;
    }
    if (stat.size > DEFAULT_PARSE_LIMITS.maxBytes) {
      return stat.size;
    }
    const bytes = await vscode.workspace.fs.readFile(uri);
    return isCurrent() ? bytes : undefined;
  }

  private unsupportedFormatState(revision: number, result: ParseResult): PanelState {
    const unsupported: Diagnostic = Object.freeze({
      code: 'unsupported-format',
      severity: 'error',
      message: 'This JSONL file does not contain a Pi session header. Return to the source editor to inspect it.'
    });
    const diagnostics = Object.freeze([
      unsupported,
      ...result.diagnostics.filter((diagnostic) => diagnostic.code !== 'missing-header')
    ]);
    const empty = parsePiSession({ bytes: new Uint8Array(), uriLabel: '', limits: DEFAULT_PARSE_LIMITS });
    return { revision, model: empty.model, diagnostics, page: latestPage(empty.model) };
  }

  private emptyState(revision: number, code: string, message: string, count?: number): PanelState {
    const result = parsePiSession({ bytes: new Uint8Array(), uriLabel: '', limits: DEFAULT_PARSE_LIMITS });
    const diagnostic: Diagnostic = Object.freeze({
      code,
      severity: 'error',
      message,
      ...(count === undefined ? {} : { detail: Object.freeze({ count, limit: DEFAULT_PARSE_LIMITS.maxBytes }) })
    });
    const diagnostics = Object.freeze([diagnostic]);
    return { revision, model: result.model, diagnostics, page: latestPage(result.model) };
  }
}

/** Avoid allocating a duplicate UTF-8 buffer for an oversized dirty editor. */
function encodeDirtyText(text: string, limit: number): Uint8Array | number {
  if (text.length > limit) {
    return text.length;
  }
  let byteLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7F) {
      byteLength += 1;
    } else if (code <= 0x7FF) {
      byteLength += 2;
    } else if (code >= 0xD800 && code <= 0xDBFF && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        byteLength += 4;
        index += 1;
      } else {
        byteLength += 3;
      }
    } else {
      byteLength += 3;
    }
    if (byteLength > limit) {
      return byteLength;
    }
  }
  return new TextEncoder().encode(text);
}

function formatBytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MiB`;
}
