# Accessibility

## v1 commitments
- Use semantic landmarks: session header, diagnostic region, transcript list, and page navigation. Each message is an `article` with a programmatic role/title and timestamp where available.
- Use real `<button>` elements for page and disclosure controls; never clickable `div`s. Keyboard: Tab/Shift+Tab, Enter/Space, visible focus; no keyboard trap.
- Use `<details>/<summary>` where practical for thinking, long tool output, and compaction; state is exposed natively. Provide a text label, not icon-only controls. Editor-title icons receive command titles/tooltips.
- Put parse/reload/page notices in a polite `aria-live` status region; critical unreadable-file state uses `role="alert"`. Do not announce every card during paging.
- Preserve copy/select text. Preformatted code/text wraps safely or supports horizontal scroll; it is not conveyed only by color.
- Use VS Code CSS variables (`--vscode-*`) and system fonts. Do not hard-code light/dark colors; maintain visible focus and non-color error/status cues.
- Respect `prefers-reduced-motion`; v1 has no essential animation. Preserve numeric reading position across rerenders; auto-follow an updated transcript only when the reader was already near its bottom, never after they have scrolled upward.

## Content rules
- All untrusted content is text, so markup cannot alter semantics.
- Tool errors include explicit `Error` text/icon label; omitted/truncated content includes count/reason text.
- Date/number display is locale-aware when valid; invalid timestamps are omitted rather than read as a misleading date.
- Do not render image content in v1; therefore no missing-alt failure. If media is added later, it requires meaningful alt/description or an explicit decorative treatment.

## Validation
Automated checks run axe-core against empty, valid, malformed, long, and high-contrast webview snapshots: **zero serious/critical violations**. Unit tests cover focusable controls and ARIA states. Manual smoke tests cover keyboard-only title-toggle → preview → source return, screen-reader announcement of diagnostics/page loads, 200% zoom, VS Code dark/light/high-contrast themes, reduced motion, and narrow editor widths. Any color contrast issue is a release blocker. Full scenarios live in [TEST-STRATEGY.md](TEST-STRATEGY.md).