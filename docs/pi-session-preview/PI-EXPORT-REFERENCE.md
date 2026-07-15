# Pi HTML exporter reference and parity

## Evidence examined
| Artifact | Finding |
|---|---|
| Installed 0.80.6 `dist/core/export-html/index.js` | Builds a self-contained HTML file; base64 encodes session data; CLI `exportFromFile()` supplies `{header, entries, leafId}`. Interactive export can additionally include system prompt, tool definitions, and pre-rendered custom tool HTML. |
| Installed `template.js` / `template.css` / `template.html` | Decodes data, builds full tree, renders a root-to-leaf path, filter/search/sidebar, Markdown via marked, highlighting via highlight.js, collapsible thinking/output/compaction, and links/download/copy controls. |
| Installed vendors | `marked.min.js` and `highlight.min.js` are embedded in each export. Package manifest reports `highlight.js` 10.7.3; rendered vendor provenance/version must be re-checked before any reuse. |
| Upstream source `pi-mono` @ `84d134…` | Confirms export pipeline, ANSI custom-tool bridge, and `SessionManager` migration/context behavior. This checkout is version 0.65.0 and not assumed identical to installed 0.80.6. |

## Behavioral reference
- `entries` contains the complete physical tree; `leafId` selects a root-to-leaf transcript. A sidebar may select another leaf. Physical last entry is the loaded manager's active leaf.
- Assistant blocks: Markdown text, collapsible thinking, then attached calls. `toolResult` is located globally by `toolCallId` and rendered beneath its call.
- Built-in specialized cards include `bash`, `read`, `write`, `edit`, and `ls` (upstream later treats `find`/`grep` as built-ins); unknown tools fall back to JSON plus result text. Interactive mode may inject extension-rendered ANSI-derived HTML.
- `compaction` is a collapsed raw-summary card. `branch_summary` is Markdown. `custom_message` renders only where `display: true`; `custom`, labels, session-info and thinking-level changes do not become primary cards.
- Template escapes many fields, disables raw Markdown HTML tokens, allow-lists link/image schemes, and highlights code. It still relies on inline scripts/styles/event attributes, `innerHTML`, data URLs, local storage, download/clipboard/link behavior, and HTML from custom tool renderers.

## v1 parity matrix
| Export behavior | v1 disposition | Reason |
|---|---|---|
| Selected active-path transcript | Adapt | Core Pi semantics; use deterministic physical-last leaf inference. |
| User/assistant text, thinking, message timestamps | Adapt | Text-only DOM rendering and accessible disclosure widgets. |
| Tool call/result pairing, error state, diff text | Adapt | Safe structured cards; bounded text. |
| Compaction, branch summary, visible custom message | Adapt | Preserve important transcript context. |
| Model/thinking/label/session-info metadata | Adapt as compact metadata | Avoid silent data loss without sidebar clutter. |
| Markdown | Adapt, deliberately narrow | A local DOM-only subset renders headings, lists, quotes, emphasis, inline code, and fenced code. Raw HTML stays literal text; links/images and all URLs remain inert/omitted. |
| Syntax highlighting/autodetect | Defer | Do not ship large vendors or autodetect in v1; fenced code uses text/code semantics only. |
| Full tree sidebar/search/deep links | Defer | Frozen scope excludes sidebar/session browser; path only and pagination fit editor UX. |
| Download JSONL, share URL, clipboard/link actions | Reject | Not needed; conflict with no-network/no-export scope. |
| Image `data:` rendering | Defer | Base64 may be oversized/untrusted; expose omitted-media metadata. |
| Interactive state/tools/system prompt | Defer | Not available from file-only export and not required for a file viewer. |
| Custom-tool pre-rendered HTML/ANSI | Reject | Requires Pi/extensions and violates the trust boundary. |
| Export CSS/layout | Do not copy wholesale | Standalone-page CSS conflicts with VS Code theme tokens, CSP, accessibility, pagination, and package-size goals. |

## Projection-layer behavior and intentional divergences
The pure `src/core/normalize.ts` layer reproduces the exporter-compatible data semantics without importing exporter code: it indexes IDs defensively, treats a missing parent as an orphan root, severs each detected parent cycle at its first physical member, selects the last accepted physical entry, and emits its root-to-leaf path. It pairs `toolResult` records with assistant calls only when their `toolCallId` matches on that active path; unmatched results remain explicit orphan tool cards with a diagnostic.

Intentional viewer divergences are documented rather than hidden:
- Alternate branches are not rendered or selectable. Their immediate off-path branch-root count is attached as `metadata.alternateBranchCount` to the last rendered active-path item.
- Assistant content is split into ordered assistant/text-thinking segments and tool cards, so interleaved calls retain persisted content order. Matched result records are attached to their call (as in the exporter) instead of becoming separate cards.
- Hidden `custom_message` entries remain out of the transcript but are counted in `summary.hiddenCustomCount`; active custom state, model/thinking changes, labels, and session-info become compact safe metadata notices rather than exporter/sidebar state.
- Unknown entries are represented by an escaped text fallback plus safe scalar metadata. This is defense in depth; the later webview must still use `textContent` and never parse the fallback as HTML.
- The projection has no Markdown AST, syntax highlighting, ANSI/custom-tool HTML, or tree sidebar. The webview applies only a small DOM-only Markdown subset to its bounded plain-text display blocks; it preserves diagnostic evidence for missing parents, cycles, branches, media omissions, and orphan tools.
- A viewer card retains at most 64 content blocks. Larger persisted arrays intentionally diverge from exporter completeness: the safe prefix is retained and the remainder becomes one counted `content-block-limit` omission. Tool arguments are likewise intentionally truncated after 16,000 display characters or 1,024 traversed JSON nodes.

## Reuse, license, attribution
Pi coding-agent is MIT (installed package metadata). **No Pi exporter runtime, vendored minified library, or template is a v1 dependency.** Reimplement behavior from the format and these observations.

If a later change copies nontrivial Pi source, CSS, or an identifiable adapted algorithm, it MUST: (1) pass security/accessibility/package review, (2) retain the source URL/revision and exact files in `THIRD-PARTY-NOTICES`, and (3) include the MIT copyright/license text required by that source. Independently implemented ideas and public format compatibility need no attribution claim. Never blindly copy HTML/inline-script/template code merely because it is MIT.

## Security divergence
The preview uses external nonce-bearing scripts, text-node rendering, an allowlisted DTO, no dynamic HTML, no remote sources, and no custom extension renderer. See [SECURITY.md](SECURITY.md).