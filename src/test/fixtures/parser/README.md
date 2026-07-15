# Parser fixture provenance

Every fixture in this directory is synthetic and manually authored from the persisted shapes in [`docs/pi-session-preview/SESSION-SCHEMA.md`](../../../../docs/pi-session-preview/SESSION-SCHEMA.md). They contain only placeholder IDs, paths, and display text; no fixture was copied from a user session, Pi export, credential, image payload, prompt, or proprietary source.

`bom-crlf-v1.jsonl` is deliberately UTF-8 with a BOM and CRLF separators. `empty.jsonl` is intentionally zero bytes. `oversized-record.jsonl` is an otherwise-valid fixture whose middle entry exceeds the small per-record limit used by its test. All expectations are asserted in `src/test/unit/parser-fixtures.test.ts`; seeded hostile-input checks are in `parser-property.test.ts`.

Created for workflow `wf_0001`, step `test-jsonl-parser`, 2026-07-15. Any new fixture must remain anonymized and record its purpose here.
