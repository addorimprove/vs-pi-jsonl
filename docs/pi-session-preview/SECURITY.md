# Security and privacy

## Threat model
A `.jsonl` file is untrusted even when local. It may contain malformed JSON, hostile Markdown/HTML/URLs, enormous text/base64, pathological nesting/tree links, ANSI/control characters, arbitrary custom-tool details, and personally sensitive transcript data. The webview boundary is also untrusted: messages can be spoofed from compromised/malformed content or stale panels.

## Required controls
### Extension host
- Use `CustomTextEditorProvider` only as a read-only projection of its supplied `TextDocument`; do not call `WorkspaceEdit`, write/save/edit/format/terminal/Pi APIs.
- Read only the local `file:` URI provided by VS Code for the opened custom document. Do not follow content-provided paths, `parentSession`, read-file tool arguments, or URLs. Remote and virtual URI schemes are rejected into a controlled read-failed state rather than being treated as local paths.
- Enforce byte/read limits before allocation where the VS Code API permits; check cancellation and dispose watchers.
- Validate all parsed fields and all `onDidReceiveMessage` payloads. Treat IDs as opaque strings; use map lookup, cycle detection, and bounded traversal.
- Development/test hosts may expose an in-memory observer of the already-posted bounded DTO solely to Extension Development Host tests; production activation exposes neither that observer nor a command, does not log content, and does not add a webview message type.
- Use `localResourceRoots` only for extension-owned `media/`; use `asWebviewUri` only for known static assets.

### Webview
- CSP baseline (generated nonce per resolve):
  ```html
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; connect-src 'none';">
  ```
  No `unsafe-inline`, remote hosts, `data:`, `blob:`, frames, forms, workers, or `connect-src` exceptions in v1. If no extension font is shipped, omit `font-src`.
- JS/CSS are extension-owned external assets; scripts carry the nonce. Do not use the Pi standalone template's inline scripts/styles/event handlers.
- Build every session-derived node with `createElement` and `textContent`. Do not use `innerHTML`, `insertAdjacentHTML`, eval, function constructors, or data-derived CSS/URL/event attributes.
- Treat text as text: raw HTML, Markdown HTML, links/images, ANSI, and tool-renderer HTML are never interpreted. The small built-in Markdown renderer creates only a fixed allowlist of DOM elements with `createElement`/`textContent` (paragraphs, headings, lists, quotes, emphasis, inline/fenced code); all URLs are displayed as inert text or omitted, including `command:` URIs. Strip/replace unsafe controls for display without changing diagnostic evidence.
- Do not render base64 image data in v1. Show a bounded `media omitted` indicator/mime metadata only.
- Runtime message validator accepts only the exact protocol in [INTERFACES.md](INTERFACES.md); stale revision, unknown type, unexpected keys, non-finite numbers, oversized pages, metadata, or nested block arrays are rejected before DOM construction.

## Privacy rules
No HTTP/WebSocket/fetch/XHR/EventSource, telemetry, analytics, crash upload, remote images, CDN, clipboard/share/download action, or process/Pi launch. Content remains in the extension host/webview memory for the open panel only. Do not log transcript text in production; diagnostics use line numbers, code, and bounded structural facts.

## Dependency policy
Prefer zero runtime parser/render dependencies. Any future parser/highlighter must be pinned, license-reviewed, bundled locally, have an XSS adversarial test, and not request network. Pi's MIT exporter is not an exception; copied portions need attribution as described in [PI-EXPORT-REFERENCE.md](PI-EXPORT-REFERENCE.md).

## Security acceptance gates
No High/Critical findings from dependency audit; CSP test has no network-capable source; XSS corpus has no executed attribute/script or unexpected DOM element; malformed/fuzz corpus completes without crash/hang/memory-limit breach; extension tests prove no write/Pi/network call. See [TEST-STRATEGY.md](TEST-STRATEGY.md).