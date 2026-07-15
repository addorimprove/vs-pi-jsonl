import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

/** Builds a nonce-bearing shell with only extension-owned CSS and JavaScript. */
export function createPreviewHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri
): string {
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    "img-src 'none'",
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'"
  ].join('; ');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${styleUri.toString()}">
  <title>Pi Session Preview</title>
</head>
<body>
  <button id="hamburger" title="Open sidebar"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><rect x="5" y="6" width="2" height="12"/><path d="M6 12h10c1 0 2 0 2-2V8"/></svg></button>
  <div id="sidebar-overlay"></div>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

/** @deprecated Compatibility alias retained for the scaffold test surface. */
export const createPlaceholderHtml = createPreviewHtml;
