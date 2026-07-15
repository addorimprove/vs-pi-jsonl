# Pi Session Preview

**Pi Session Preview** is an optional, read-only VS Code viewer for local Pi session JSONL files. It presents the latest active branch in a Pi HTML-export-style interface without starting Pi or changing the source file.

## Use

Supported on **desktop VS Code 1.127+** with local `file:` JSONL documents.

1. Open a `.jsonl` file normally; JSONL remains a text editor by default.
2. Select **Open Pi Session Preview** in the editor title, or choose **Open With… → Pi Session Preview**.
3. Browse the active-path transcript with the session tree. Search entries or select **Default**, **No-tools**, **User**, **Labeled**, or **All** to filter the tree.
4. Press **T** to toggle thinking and **O** to toggle tool output. The sidebar is resizable on desktop and becomes a drawer in narrow editor groups.
5. Select **Open JSONL Source** in the preview title to return to the normal text editor in the same editor group.

Earlier bounded pages are loaded automatically into one continuous transcript. The preview also refreshes when the same local document changes. Unsaved text-document buffers are visible, but the extension never writes them back.

## Privacy and safety

- Reads only the opened local `file:` document while its preview is alive.
- Does not edit, save, format, execute, upload, share, export, scan a workspace, start Pi, or make network requests.
- Has no telemetry, analytics, remote assets, runtime CDN, or Pi runtime dependency.
- Treats every session string as untrusted text. Raw HTML, links, images, `command:` URIs, ANSI/custom-tool HTML, and base64 media are inert or omitted.
- Uses a restrictive webview CSP, validated bounded messages, and DOM text-node rendering.

See [Security and privacy](docs/pi-session-preview/SECURITY.md) for the threat model and controls.

## What it shows

Pi v1–v3 session data is parsed locally with recovery around malformed lines. The viewer can show messages, assistant text/thinking, paired or orphaned tool results, compaction, visible custom messages, branch summaries, selected metadata, and diagnostics. The presentation follows Pi's HTML session export: a searchable session tree, dense monospace transcript, collapsible thinking and tool output, reference-style message colors, copyable entry links, and a responsive sidebar.

The extension displays only the inferred latest active path and keeps transcript pages, diagnostics, content blocks, and tool display data within fixed limits.

## Limitations

- Only desktop VS Code 1.127+ local files are supported. Remote SSH, WSL, Dev Containers, VS Code Web, Cursor, VSCodium, virtual/workspace providers, and non-`file:` URIs are unsupported and unverified.
- This is not a Pi client, editor, full branch browser, exporter, or rich custom-tool host.
- The tree represents the normalized active path; inactive alternate branches are not available through the current safe protocol.
- Full syntax highlighting, full CommonMark, active links/images/media, system prompts, tool catalogs, custom-tool renderers, configurable limits, persistent presentation state, and future Pi formats are deferred.
- Markdown is intentionally a small safe subset. Raw HTML is shown literally; URLs are not activated.
- Native title-button pixels, screen-reader speech, DevTools console, forced-colors, zoom, and physical scroll geometry require the documented manual desktop smoke check; automated VS Code-host, DOM, and accessibility checks cover the functional flow.

## Public repository safety

This repository is intended to remain public. Real Pi sessions can contain prompts, tool output, local paths, source code, credentials, and other private data, so session exports and JSONL files must not be committed. The `sessions/` directory, VSIX packages, build output, benchmarks, and local subagent artifacts are ignored.

Before opening a pull request:

```sh
git status --short
git diff --check
npm run verify
```

Use only synthetic fixtures under `src/test/fixtures/`. Never replace them with personal session data, even temporarily in a commit.

## Development and release checks

```sh
npm ci
npm run verify
npm run benchmark:large
npm run package:vsix
```

`npm run verify` runs lint, strict typecheck, unit/security/accessibility checks, manifest checks, VS Code Extension Development Host tests, packaging checks, and the production dependency audit. `npm run benchmark:large` creates synthetic temporary inputs and deletes them in `finally`.

The resulting `pi-session-preview.vsix` is the release-candidate artifact. Do not publish it from this repository workflow.

## Architecture and evidence

- [Architecture](docs/pi-session-preview/ARCHITECTURE.md)
- [Requirements](docs/pi-session-preview/REQUIREMENTS.md)
- [Pi HTML-export parity and divergences](docs/pi-session-preview/PI-EXPORT-REFERENCE.md)
- [Final release-candidate report](docs/pi-session-preview/evidence/final-report.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD-PARTY-NOTICES.md)

## License

This project is licensed under [MIT](LICENSE). It independently implements Pi persisted-format/export semantics and packages no Pi exporter code or vendor assets; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
