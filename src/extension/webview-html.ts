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
  <a class="skip-link" href="#transcript">Skip to transcript</a>
  <main id="app" tabindex="-1"></main>
  <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
</body>
</html>`;
}

/** @deprecated Compatibility alias retained for the scaffold test surface. */
export const createPlaceholderHtml = createPreviewHtml;
