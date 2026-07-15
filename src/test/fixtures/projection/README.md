# Session-projection fixtures

These synthetic, manually readable JSONL fixtures exercise the pure bounded projection produced by `parsePiSession`. Each `.expected.json` is the checked JSON-serializable projection output (`model` plus diagnostic code/line), generated only after review; it is intentionally committed so card order and safe DTO shape are visible in code review.

- `linear-v1` verifies generated v1 IDs, linear active path, and compaction index rewriting.
- `active-branch-content` verifies physical-last active-leaf inference, alternate branch counting, interleaved text/thinking/tool-call card order, matched and orphaned results, bash, compaction, branch summary, custom visibility, model/thinking changes, escaped unknown text, and final labels.
- `missing-parent` verifies orphan-root recovery when the physical-last entry references an absent parent.
- `cycles` verifies deterministic recovery from self-parenting and a three-node parent cycle.

The fixtures contain only synthetic identifiers and display strings. Custom-message `data` in `active-branch-content` is deliberately nested and behavior-shaped to prove it does not cross the normalized-model boundary; its HTML-like text remains a string for a text-node renderer, not executable markup.

`pi-export-semantics.expected.json` is a small reviewed semantic reference for the shared active-branch fixture. The normal test compares the preview model to it without requiring Pi. When `pi` is installed, the optional observational test exports a temporary copy with telemetry/version checks disabled, decodes `script#session-data`, and compares the exporter’s selected path, roles/content, tool association, compaction, and custom-message visibility to the same reference. It never snapshots exporter HTML or runs session content.

Created for workflow `wf_0001`, steps `test-session-projection` and `test-secure-webview`, 2026-07-15.
