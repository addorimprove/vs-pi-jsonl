declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): { revision?: number; start?: number; scrollTop?: number } | undefined;
  setState(state: { revision: number; start: number; scrollTop: number }): void;
};

type Scalar = string | number | boolean;
type Block = { kind: 'text' | 'thinking' | 'code'; text: string; truncated?: boolean };
type Tool = { callId?: string; name: string; argumentsText?: string; resultText?: string; isError?: boolean; unmatchedResult?: boolean; truncated?: boolean };
type Item = { key: string; sourceId: string; sourceLine: number; kind: string; timestamp?: string; title?: string; blocks?: Block[]; tool?: Tool; metadata?: Record<string, Scalar>; omitted?: { reason: string; originalSize?: number } };
type Page = { start: number; total: number; items: Item[]; hasOlder: boolean; hasNewer: boolean };
type Diagnostic = { code: string; severity: 'info' | 'warning' | 'error'; line?: number; message: string; detail?: { count?: number; limit?: number } };
type Summary = { version: 1 | 2 | 3 | 'unknown'; pathItemCount: number; hiddenCustomCount: number; sessionId?: string; name?: string; cwd?: string; activeLeafId?: string };
type Limits = { pageItems: number; maxRenderedItems: number; textCharsPerBlock: number; maxDiagnostics: number };
type HostMessage =
  | { protocol: 1; type: 'init'; revision: number; summary: Summary; diagnostics: Diagnostic[]; page: Page; limits: Limits }
  | { protocol: 1; type: 'page'; revision: number; page: Page }
  | { protocol: 1; type: 'error'; revision: number; message: string };
type TreeFilter = 'default' | 'no-tools' | 'user-only' | 'labeled-only' | 'all';

const vscode = acquireVsCodeApi();
const root = document.getElementById('app');
if (root === null) throw new Error('Pi Session Preview root is unavailable.');
const app: HTMLElement = root;
const savedNavigation = vscode.getState();
const MAX_HOST_STRING_CHARS = 32_000;
const MAX_BLOCKS_PER_ITEM = 64;
const AUTO_FOLLOW_DISTANCE = 96;
let revision = -1;
let page: Page | undefined;
let summary: Summary | undefined;
let diagnostics: Diagnostic[] = [];
let limits: Limits | undefined;
let loadedPages = new Map<number, Page>();
let treeSearch = '';
let treeFilter: TreeFilter = 'default';
let sidebarOpen = false;
let sidebarWidth = 400;
let thinkingExpanded = true;
let toolOutputsExpanded = false;

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  if (message === undefined) return;
  if (message.type === 'error') {
    revision = message.revision;
    renderError(message.message);
    return;
  }
  const scroll = page === undefined ? undefined : captureScroll();
  if (message.type === 'init') {
    revision = message.revision;
    summary = message.summary;
    diagnostics = message.diagnostics;
    limits = message.limits;
    page = message.page;
    loadedPages = new Map([[message.page.start, message.page]]);
    render(scroll, true);
    requestOlder(message.page);
    return;
  }
  if (message.revision !== revision) return;
  page = message.page;
  loadedPages.set(message.page.start, message.page);
  render(scroll, false);
  requestOlder(message.page);
});

window.addEventListener('scroll', persistNavigation, { passive: true });
vscode.postMessage({ protocol: 1, type: 'ready' });

function requestOlder(value: Page): void {
  if (!value.hasOlder) return;
  vscode.postMessage({ protocol: 1, type: 'requestPage', revision, direction: 'older', anchor: value.start });
}

function allItems(): Item[] {
  return [...loadedPages.values()].sort((a, b) => a.start - b.start).flatMap((value) => value.items);
}

function render(previousScroll?: ScrollState, shouldAutoFollow = false): void {
  if (page === undefined || summary === undefined || limits === undefined) return;
  const hamburger = ensureHamburger();
  const overlay = ensureOverlay();
  app.replaceChildren();
  const items = allItems();
  const sidebar = renderSidebar(items);
  if (sidebarOpen) {
    sidebar.classList.add('open');
    overlay.classList.add('open');
  }
  const resizer = element('div');
  resizer.id = 'sidebar-resizer';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize session tree sidebar');
  resizer.setAttribute('aria-valuemin', '240');
  resizer.setAttribute('aria-valuemax', '840');
  resizer.setAttribute('aria-valuenow', String(sidebarWidth));
  resizer.tabIndex = 0;
  const content = element('main');
  content.id = 'content';
  const headerContainer = element('div');
  headerContainer.id = 'header-container';
  headerContainer.append(renderHeader(summary, items), renderDiagnostics(diagnostics.slice(0, limits.maxDiagnostics)));
  const messages = element('div');
  messages.id = 'messages';
  if (items.length === 0) {
    const empty = element('div', 'empty-state');
    empty.textContent = 'No supported conversation content was available. Use the source editor to inspect the JSONL.';
    messages.append(empty);
  } else {
    for (const item of items) messages.append(renderItem(item));
  }
  content.append(headerContainer, messages);
  app.append(sidebar, resizer, content);
  bindChrome(hamburger, overlay, sidebar, resizer);
  applyToggleStates();
  restoreScroll(previousScroll, shouldAutoFollow);
  navigateFromHash();
}

function ensureHamburger(): HTMLButtonElement {
  let button = document.querySelector<HTMLButtonElement>('#hamburger');
  if (button !== null) return button;
  button = document.createElement('button');
  button.id = 'hamburger';
  button.title = 'Open sidebar';
  button.setAttribute('aria-label', 'Open sidebar');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('viewBox', '0 0 24 24');
  svg.textContent = '☷';
  button.append(svg);
  document.body.insertBefore(button, app);
  return button;
}

function ensureOverlay(): HTMLElement {
  let overlay = document.getElementById('sidebar-overlay');
  if (overlay !== null) return overlay;
  overlay = element('div');
  overlay.id = 'sidebar-overlay';
  document.body.insertBefore(overlay, app);
  return overlay;
}

interface ScrollState { readonly top: number; readonly nearBottom: boolean }
function captureScroll(): ScrollState {
  const top = Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop);
  const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return { top, nearBottom: maximum - top <= AUTO_FOLLOW_DISTANCE };
}
function restoreScroll(previous: ScrollState | undefined, shouldAutoFollow: boolean): void {
  const saved = previous?.top ?? (savedNavigation?.revision === revision && isNonNegativeInteger(savedNavigation.scrollTop) ? savedNavigation.scrollTop : 0);
  const apply = (): void => {
    const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const target = shouldAutoFollow && previous?.nearBottom === true ? maximum : Math.min(saved, maximum);
    window.scrollTo({ top: target, behavior: 'auto' });
    persistNavigation();
  };
  if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(apply); else apply();
}
function persistNavigation(): void {
  if (page === undefined) return;
  vscode.setState({ revision, start: page.start, scrollTop: Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop) });
}

function renderHeader(value: Summary, items: readonly Item[]): HTMLElement {
  const header = element('div', 'header');
  const heading = element('h1');
  heading.textContent = `Session: ${value.sessionId ?? value.name ?? 'unknown'}`;
  const help = element('div', 'help-bar');
  const hint = element('span', 'help-hint');
  hint.textContent = 'T toggle thinking · O toggle tools';
  const actions = element('div', 'help-actions');
  actions.append(toggleButton('Toggle thinking', 'Toggle thinking (T)', toggleThinking), toggleButton('Toggle tools', 'Toggle tools (O)', toggleTools));
  help.append(hint, actions);
  const info = element('div', 'header-info');
  const counts = (kind: string): number => items.filter((item) => item.kind === kind).length;
  const messages = [countPart(counts('user'), 'user'), countPart(counts('assistant'), 'assistant'), countPart(counts('tool') + counts('bash'), 'tool results'), countPart(counts('customMessage'), 'custom'), countPart(counts('compaction'), 'compactions'), countPart(counts('branchSummary'), 'branch summaries')].filter(Boolean).join(', ') || '0';
  const firstTimestamp = items.find((item) => item.timestamp !== undefined)?.timestamp;
  const models = [...new Set(items.flatMap((item) => {
    const model = item.metadata?.modelId ?? item.metadata?.model;
    return typeof model === 'string' ? [model] : [];
  }))];
  info.append(infoItem('Date:', firstTimestamp === undefined ? 'unknown' : (formatTimestamp(firstTimestamp) ?? 'unknown')),
    infoItem('Models:', models.join(', ') || 'unknown'), infoItem('Messages:', messages),
    infoItem('Tool Calls:', String(items.filter((item) => item.tool !== undefined).length)));
  header.append(heading, help, info);
  return header;
}
function toggleButton(label: string, title: string, handler: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'header-toggle-btn'; button.textContent = label; button.title = title;
  button.addEventListener('click', handler); return button;
}
function infoItem(label: string, value: string): HTMLElement {
  const item = element('div', 'info-item');
  const name = element('span', 'info-label'); name.textContent = label;
  const content = element('span', 'info-value'); content.textContent = value;
  item.append(name, content); return item;
}
function countPart(count: number, label: string): string { return count === 0 ? '' : `${count} ${label}`; }

function renderDiagnostics(values: readonly Diagnostic[]): HTMLElement {
  const section = element('section', 'diagnostics');
  if (values.length === 0) return section;
  const heading = element('h2'); heading.textContent = 'Session warnings';
  const list = element('ul');
  for (const value of values) {
    const item = element('li', `diagnostic diagnostic-${value.severity}`);
    item.textContent = diagnosticText(value); if (value.severity === 'error') item.setAttribute('role', 'alert'); list.append(item);
  }
  section.append(heading, list); return section;
}

function renderItem(item: Item): HTMLElement {
  if (item.kind === 'user') return renderMessage(item, 'user-message');
  if (item.kind === 'assistant') return renderMessage(item, 'assistant-message');
  if (item.kind === 'tool' || item.kind === 'bash') return renderToolItem(item);
  if (item.kind === 'compaction') return renderCompaction(item);
  if (item.kind === 'branchSummary') return renderBranchSummary(item);
  if (item.kind === 'modelChange' || item.kind === 'thinkingChange' || item.kind === 'label' || item.kind === 'sessionInfo') return renderModelChange(item);
  return renderCustom(item);
}
function renderMessage(item: Item, className: string): HTMLElement {
  const container = element('div', className); setEntryIdentity(container, item); container.append(copyLinkButton(item));
  appendTimestamp(container, item);
  for (const block of (item.blocks ?? []).slice(0, MAX_BLOCKS_PER_ITEM)) {
    if (block.kind === 'thinking') container.append(renderThinking(block));
    else {
      const content = element('div', className === 'assistant-message' ? 'assistant-text markdown-content' : 'markdown-content');
      renderMarkdown(content, block.text); if (block.truncated === true) content.append(truncationNotice()); container.append(content);
    }
  }
  if (item.tool !== undefined) container.append(renderTool(item.tool));
  appendOmitted(container, item); return container;
}
function renderThinking(block: Block): HTMLElement {
  const wrapper = element('div', 'thinking-block');
  const text = element('div', 'thinking-text'); text.textContent = block.text;
  const collapsed = element('div', 'thinking-collapsed'); collapsed.textContent = 'Thinking ...';
  wrapper.append(text, collapsed); if (block.truncated === true) wrapper.append(truncationNotice()); return wrapper;
}
function renderToolItem(item: Item): HTMLElement {
  const tool = item.tool ?? { name: item.title ?? 'tool' };
  const container = renderTool(tool); setEntryIdentity(container, item); appendTimestamp(container, item, true); appendOmitted(container, item); return container;
}
function renderTool(tool: Tool): HTMLElement {
  const status = tool.resultText === undefined ? 'pending' : tool.isError === true ? 'error' : 'success';
  const container = element('div', `tool-execution ${status}`);
  const args = parseArguments(tool.argumentsText);
  const name = tool.name;
  if (name === 'bash') {
    const command = element('div', 'tool-command'); command.textContent = `$ ${stringArg(args, 'command') ?? tool.argumentsText ?? '...'}`; container.append(command);
    if (tool.resultText !== undefined) container.append(formatOutput(tool.resultText, 5));
  } else {
    const header = element('div', 'tool-header');
    const toolName = element('span', 'tool-name'); toolName.textContent = name;
    header.append(toolName);
    const path = stringArg(args, 'file_path') ?? stringArg(args, 'path');
    if (path !== undefined) { const pathNode = element('span', 'tool-path'); pathNode.textContent = ` ${shortenPath(path)}`; header.append(pathNode); }
    container.append(header);
    if (name === 'write') {
      const content = stringArg(args, 'content'); if (content !== undefined) container.append(formatOutput(content, 10));
    } else if (name === 'edit' && tool.resultText !== undefined && /^[+\- ]/m.test(tool.resultText)) {
      container.append(renderDiff(tool.resultText));
    } else if (tool.argumentsText !== undefined && path === undefined) {
      const argsOutput = element('div', 'tool-output'); const pre = document.createElement('pre'); pre.textContent = tool.argumentsText; argsOutput.append(pre); container.append(argsOutput);
    }
    if (tool.resultText !== undefined) container.append(formatOutput(tool.resultText, name === 'ls' ? 20 : 10));
  }
  if (tool.unmatchedResult === true) { const error = element('div', 'tool-error'); error.textContent = 'Unmatched tool result.'; container.append(error); }
  if (tool.truncated === true) container.append(truncationNotice());
  return container;
}
function formatOutput(text: string, previewLines: number): HTMLElement {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output = element('div', `tool-output${lines.length > previewLines ? ' expandable' : ''}`);
  const appendLines = (parent: HTMLElement, values: readonly string[]): void => { for (const line of values) { const row = element('div'); row.textContent = line.replace(/\t/g, '  '); parent.append(row); } };
  if (lines.length > previewLines) {
    const preview = element('div', 'output-preview'); appendLines(preview, lines.slice(0, previewLines));
    const hint = element('div', 'expand-hint'); hint.textContent = `... (${lines.length - previewLines} more lines)`; preview.append(hint);
    const full = element('div', 'output-full'); appendLines(full, lines); output.append(preview, full);
    output.addEventListener('click', () => { if (window.getSelection()?.toString()) return; output.classList.toggle('expanded'); });
  } else appendLines(output, lines);
  return output;
}
function renderDiff(text: string): HTMLElement {
  const diff = element('div', 'tool-diff');
  for (const line of text.split('\n')) { const row = element('div', line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : 'diff-context'); row.textContent = line; diff.append(row); }
  return diff;
}
function parseArguments(text: string | undefined): Record<string, unknown> {
  if (text === undefined) return {};
  try { const value: unknown = JSON.parse(text); return isRecord(value) ? value : {}; } catch { return {}; }
}
function stringArg(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === 'string' ? value[key] : undefined; }
function shortenPath(path: string): string { return summary?.cwd !== undefined && path.startsWith(`${summary.cwd}/`) ? path.slice(summary.cwd.length + 1) : path; }

function renderCompaction(item: Item): HTMLElement {
  const container = element('div', 'compaction'); setEntryIdentity(container, item); appendTimestamp(container, item);
  const label = element('div', 'compaction-label'); label.textContent = '[compaction]';
  const tokenCount = typeof item.metadata?.tokensBefore === 'number' ? item.metadata.tokensBefore.toLocaleString() : undefined;
  const collapsed = element('div', 'compaction-collapsed'); collapsed.textContent = tokenCount === undefined ? 'Compacted context' : `Compacted from ${tokenCount} tokens`;
  const content = element('div', 'compaction-content markdown-content'); for (const block of item.blocks ?? []) renderMarkdown(content, block.text);
  container.append(label, collapsed, content); appendOmitted(container, item); container.addEventListener('click', () => { if (window.getSelection()?.toString()) return; container.classList.toggle('expanded'); }); return container;
}
function renderBranchSummary(item: Item): HTMLElement {
  const container = element('div', 'branch-summary'); setEntryIdentity(container, item); appendTimestamp(container, item);
  const header = element('div', 'branch-summary-header'); header.textContent = 'Branch Summary'; container.append(header);
  for (const block of item.blocks ?? []) { const content = element('div', 'markdown-content'); renderMarkdown(content, block.text); container.append(content); } return container;
}
function renderCustom(item: Item): HTMLElement {
  const container = element('div', 'hook-message'); setEntryIdentity(container, item); appendTimestamp(container, item);
  const type = element('span', 'hook-type'); type.textContent = item.title ?? 'Custom message'; container.append(type);
  for (const block of item.blocks ?? []) { const content = element('div', 'markdown-content'); renderMarkdown(content, block.text); container.append(content); } return container;
}
function renderModelChange(item: Item): HTMLElement {
  const container = element('div', 'model-change'); setEntryIdentity(container, item);
  const model = item.metadata?.modelId ?? item.metadata?.model ?? item.metadata?.thinkingLevel ?? item.title ?? titleFor(item.kind);
  container.append(document.createTextNode(`${titleFor(item.kind)}: `)); const name = element('span', 'model-name'); name.textContent = String(model); container.append(name); return container;
}
function setEntryIdentity(elementValue: HTMLElement, item: Item): void { elementValue.id = `entry-${safeId(item.key)}`; elementValue.dataset.key = item.key; }
function appendTimestamp(target: HTMLElement, item: Item, first = false): void {
  if (item.timestamp === undefined) return; const value = formatTimestamp(item.timestamp); if (value === undefined) return;
  const timestamp = element('div', 'message-timestamp'); timestamp.textContent = value; if (first) target.prepend(timestamp); else target.append(timestamp);
}
function appendOmitted(target: HTMLElement, item: Item): void { if (item.omitted === undefined) return; const notice = element('div', 'omitted-notice'); notice.textContent = `Content omitted: ${item.omitted.reason}${item.omitted.originalSize === undefined ? '' : ` (${item.omitted.originalSize} characters)`}.`; target.append(notice); }
function copyLinkButton(item: Item): HTMLButtonElement {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'copy-link-btn'; button.title = 'Copy link to this message'; button.dataset.entryId = item.key;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('width', '14'); svg.setAttribute('height', '14'); svg.setAttribute('viewBox', '0 0 24 24'); svg.textContent = '↗'; button.append(svg);
  button.addEventListener('click', (event) => { event.stopPropagation(); const hash = `entry-${safeId(item.key)}`; window.location.hash = hash; navigateFromHash(); void navigator.clipboard?.writeText(window.location.href).then(() => { button.classList.add('copied'); button.textContent = '✓'; window.setTimeout(() => { button.classList.remove('copied'); button.replaceChildren(svg); }, 1500); }).catch(() => undefined); });
  return button;
}
function safeId(value: string): string { return value.replace(/[^a-zA-Z0-9_-]/g, '-'); }
function navigateFromHash(): void { const id = window.location.hash.slice(1); if (id === '') return; const target = document.getElementById(id); if (target === null) return; target.scrollIntoView?.({ block: 'center' }); target.classList.add('highlight'); }

function renderSidebar(items: readonly Item[]): HTMLElement {
  const sidebar = element('aside'); sidebar.id = 'sidebar'; sidebar.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  const header = element('div', 'sidebar-header'); const controls = element('div', 'sidebar-controls');
  const search = document.createElement('input'); search.type = 'text'; search.className = 'sidebar-search'; search.id = 'tree-search'; search.placeholder = 'Search...'; search.value = treeSearch; controls.append(search);
  const filters = element('div', 'sidebar-filters');
  const choices: Array<[TreeFilter, string, string]> = [['default','Default','Hide settings entries'],['no-tools','No-tools','Default minus tool results'],['user-only','User','Only user messages'],['labeled-only','Labeled','Only labeled entries'],['all','All','Show everything']];
  for (const [filter,label,title] of choices) { const button = document.createElement('button'); button.type = 'button'; button.className = `filter-btn${filter === treeFilter ? ' active' : ''}`; button.dataset.filter = filter; button.textContent = label; button.title = title; button.addEventListener('click', () => { treeFilter = filter; updateTree(sidebar, items); for (const candidate of filters.querySelectorAll('.filter-btn')) candidate.classList.toggle('active', (candidate as HTMLElement).dataset.filter === filter); }); filters.append(button); }
  const close = document.createElement('button'); close.type = 'button'; close.className = 'sidebar-close'; close.id = 'sidebar-close'; close.title = 'Close'; close.textContent = '✕'; close.addEventListener('click', () => closeSidebar()); filters.append(close);
  header.append(controls, filters); const tree = element('div', 'tree-container'); tree.id = 'tree-container'; const status = element('div', 'tree-status'); status.id = 'tree-status'; sidebar.append(header, tree, status);
  search.addEventListener('input', () => { treeSearch = search.value; updateTree(sidebar, items); }); updateTree(sidebar, items); return sidebar;
}
function updateTree(sidebar: HTMLElement, items: readonly Item[]): void {
  const container = sidebar.querySelector<HTMLElement>('#tree-container'); const status = sidebar.querySelector<HTMLElement>('#tree-status'); if (container === null || status === null) return; container.replaceChildren();
  const visible = items.filter((item) => treeVisible(item));
  for (const [index,item] of visible.entries()) { const node = element('div', 'tree-node in-path'); node.dataset.id = item.key; node.tabIndex = 0;
    const prefix = element('span', 'tree-prefix'); prefix.textContent = index === visible.length - 1 ? '└─' : '├─'; const marker = element('span', 'tree-marker'); marker.textContent = '•'; const content = element('span', 'tree-content');
    const role = element('span', treeRoleClass(item.kind)); role.textContent = `${treeRoleLabel(item.kind)}:`; content.append(role, document.createTextNode(` ${treeLabel(item)}`)); node.append(prefix, marker, content);
    const activate = (): void => { for (const candidate of container.querySelectorAll('.tree-node')) candidate.classList.remove('active'); node.classList.add('active'); const target = document.getElementById(`entry-${safeId(item.key)}`); target?.scrollIntoView?.({ block: 'center' }); target?.classList.add('highlight'); if (window.matchMedia?.('(max-width: 900px)').matches === true) closeSidebar(); };
    node.addEventListener('click', activate); node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }); container.append(node); }
  status.textContent = `${visible.length} / ${items.length} entries`;
}
function treeVisible(item: Item): boolean { const setting = item.kind === 'sessionInfo' || item.kind === 'modelChange' || item.kind === 'thinkingChange'; const filter = treeFilter === 'all' || (treeFilter === 'default' && !setting) || (treeFilter === 'no-tools' && !setting && item.kind !== 'tool' && item.kind !== 'bash') || (treeFilter === 'user-only' && item.kind === 'user') || (treeFilter === 'labeled-only' && item.kind === 'label'); if (!filter) return false; const query = treeSearch.trim().toLocaleLowerCase(); return query === '' || [item.kind,item.title,treeLabel(item),item.tool?.name].filter(Boolean).join(' ').toLocaleLowerCase().includes(query); }
function treeRoleClass(kind: string): string { if (kind === 'user') return 'tree-role-user'; if (kind === 'assistant') return 'tree-role-assistant'; if (kind === 'tool' || kind === 'bash') return 'tree-role-tool'; if (kind === 'customMessage' || kind === 'compaction') return 'tree-role-skill'; return 'tree-muted'; }
function treeRoleLabel(kind: string): string { if (kind === 'customMessage') return 'custom'; if (kind === 'branchSummary') return 'branch summary'; return kind; }
function treeLabel(item: Item): string { const text = item.blocks?.find((block) => block.text.trim() !== '')?.text.replace(/[\n\t]/g, ' ').trim() ?? item.title ?? titleFor(item.kind); return text.length > 100 ? `${text.slice(0,100)}...` : text; }
function bindChrome(hamburger: HTMLButtonElement, overlay: HTMLElement, sidebar: HTMLElement, resizer: HTMLElement): void { hamburger.onclick = () => openSidebar(); overlay.onclick = () => closeSidebar(); resizer.onpointerdown = (event) => { event.preventDefault(); document.body.classList.add('sidebar-resizing'); const move = (moveEvent: PointerEvent): void => { sidebarWidth = Math.min(840, Math.max(240, moveEvent.clientX)); sidebar.style.setProperty('--sidebar-width', `${sidebarWidth}px`); resizer.setAttribute('aria-valuenow', String(sidebarWidth)); }; const stop = (): void => { document.body.classList.remove('sidebar-resizing'); window.removeEventListener('pointermove', move); }; window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); }; }
function openSidebar(): void { sidebarOpen = true; document.getElementById('sidebar')?.classList.add('open'); document.getElementById('sidebar-overlay')?.classList.add('open'); }
function closeSidebar(): void { sidebarOpen = false; document.getElementById('sidebar')?.classList.remove('open'); document.getElementById('sidebar-overlay')?.classList.remove('open'); }
function toggleThinking(): void { thinkingExpanded = !thinkingExpanded; applyToggleStates(); }
function toggleTools(): void { toolOutputsExpanded = !toolOutputsExpanded; applyToggleStates(); }
function applyToggleStates(): void { for (const text of document.querySelectorAll<HTMLElement>('.thinking-text')) text.style.display = thinkingExpanded ? '' : 'none'; for (const collapsed of document.querySelectorAll<HTMLElement>('.thinking-collapsed')) collapsed.style.display = thinkingExpanded ? 'none' : 'block'; for (const output of document.querySelectorAll<HTMLElement>('.tool-output.expandable')) output.classList.toggle('expanded', toolOutputsExpanded); for (const expandable of document.querySelectorAll<HTMLElement>('.compaction,.skill-invocation')) expandable.classList.toggle('expanded', toolOutputsExpanded); }
window.addEventListener('keydown', (event) => { const target = event.target; if (target instanceof HTMLElement && target.matches('input,textarea,select,button,[contenteditable="true"]')) return; if (event.key === 'Escape') { treeSearch = ''; const search = document.querySelector<HTMLInputElement>('#tree-search'); if (search !== null) { search.value = ''; if (page !== undefined) updateTree(document.getElementById('sidebar') as HTMLElement, allItems()); } closeSidebar(); } else if (event.key.toLocaleLowerCase() === 't') toggleThinking(); else if (event.key.toLocaleLowerCase() === 'o') toggleTools(); else return; event.preventDefault(); });

function renderMarkdown(target: HTMLElement, text: string): void {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length;) { const line = lines[index] ?? ''; const fence = /^```([^`]*)$/.exec(line); if (fence !== null) { const code: string[] = []; index += 1; while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) { code.push(lines[index] ?? ''); index += 1; } if (index < lines.length) index += 1; target.append(codeBlock(code.join('\n'))); continue; } const heading = /^(#{1,6})\s+(.*)$/.exec(line); if (heading !== null) { const h = document.createElement(`h${heading[1]?.length ?? 1}`); appendInline(h, heading[2] ?? ''); target.append(h); index += 1; continue; } if (/^\s*[-*+]\s+/.test(line)) { const list = document.createElement('ul'); while (index < lines.length) { const match = /^\s*[-*+]\s+(.*)$/.exec(lines[index] ?? ''); if (match === null) break; const item = document.createElement('li'); appendInline(item, match[1] ?? ''); list.append(item); index += 1; } target.append(list); continue; } if (line.trim() === '') { index += 1; continue; } const paragraph = document.createElement('p'); appendInline(paragraph, line); target.append(paragraph); index += 1; }
}
function appendInline(target: HTMLElement, text: string): void { let remaining = text; while (remaining !== '') { const match = /(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]*\]\([^)]*\))/.exec(remaining); if (match === null || match.index === undefined) { target.append(document.createTextNode(remaining)); return; } if (match.index > 0) target.append(document.createTextNode(remaining.slice(0,match.index))); const token = match[0]; if (token.startsWith('`')) { const code = document.createElement('code'); code.textContent = token.slice(1,-1); target.append(code); } else if (token.startsWith('**')) { const strong = document.createElement('strong'); strong.textContent = token.slice(2,-2); target.append(strong); } else if (token.startsWith('*')) { const emphasis = document.createElement('em'); emphasis.textContent = token.slice(1,-1); target.append(emphasis); } else { const label = /^\[([^\]]*)\]/.exec(token)?.[1] ?? ''; target.append(document.createTextNode(`${label} (link omitted)`)); } remaining = remaining.slice(match.index + token.length); } }
function codeBlock(text: string): HTMLElement { const pre = document.createElement('pre'); const code = document.createElement('code'); code.className = 'hljs'; code.textContent = text; pre.append(code); return pre; }
function truncationNotice(): HTMLElement { const notice = element('div', 'omitted-notice'); notice.textContent = 'Displayed text was truncated by the preview limit.'; return notice; }
function diagnosticText(value: Diagnostic): string { return `${value.severity.toUpperCase()}: ${value.line === undefined ? '' : `Line ${value.line}: `}${value.message}${value.detail?.limit === undefined ? '' : ` (limit ${value.detail.limit})`}`; }
function formatTimestamp(value: string): string | undefined { const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString(); }
function titleFor(kind: string): string { const titles: Record<string,string> = { user:'User',assistant:'Assistant',tool:'Tool',bash:'Bash execution',compaction:'Compaction',branchSummary:'Branch summary',customMessage:'Custom message',modelChange:'Model change',thinkingChange:'Thinking level change',label:'Label',sessionInfo:'Session information',unknown:'Unknown entry' }; return titles[kind] ?? 'Session entry'; }
function element(name: string, className?: string): HTMLElement { const value = document.createElement(name); if (className !== undefined) value.className = className; return value; }
function renderError(message: string): void { app.replaceChildren(); const alert = element('section', 'error-state'); alert.setAttribute('role','alert'); const heading = document.createElement('h1'); heading.textContent = 'Pi Session Preview unavailable'; const text = document.createElement('p'); text.textContent = message; alert.append(heading,text); app.append(alert); }

function parseHostMessage(value: unknown): HostMessage | undefined {
  if (!isRecord(value) || value.protocol !== 1 || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'init' && hasExactKeys(value, ['protocol', 'type', 'revision', 'summary', 'diagnostics', 'page', 'limits']) && isRevision(value.revision) && isSummary(value.summary) && Array.isArray(value.diagnostics) && value.diagnostics.length <= 100 && value.diagnostics.every(isDiagnostic) && isPage(value.page) && isLimits(value.limits)) {
    return { protocol: 1, type: 'init', revision: value.revision, summary: value.summary, diagnostics: value.diagnostics, page: value.page, limits: value.limits };
  }
  if (value.type === 'page' && hasExactKeys(value, ['protocol', 'type', 'revision', 'page']) && isRevision(value.revision) && isPage(value.page)) {
    return { protocol: 1, type: 'page', revision: value.revision, page: value.page };
  }
  if (value.type === 'error' && hasExactKeys(value, ['protocol', 'type', 'revision', 'message']) && isRevision(value.revision) && isBoundedString(value.message)) {
    return { protocol: 1, type: 'error', revision: value.revision, message: value.message };
  }
  return undefined;
}

function isPage(value: unknown): value is Page {
  return isRecord(value) && hasExactKeys(value, ['start', 'total', 'items', 'hasOlder', 'hasNewer']) && isNonNegativeInteger(value.start) && isNonNegativeInteger(value.total) && Array.isArray(value.items) && value.items.length <= 100 && value.items.every(isItem) && typeof value.hasOlder === 'boolean' && typeof value.hasNewer === 'boolean' && value.start <= value.total && value.start + value.items.length <= value.total;
}

function isItem(value: unknown): value is Item {
  if (!isRecord(value) || !hasOnlyKeys(value, ['key', 'sourceId', 'sourceLine', 'kind', 'timestamp', 'title', 'blocks', 'tool', 'metadata', 'omitted']) || !isBoundedString(value.key) || !isBoundedString(value.sourceId) || !isNonNegativeInteger(value.sourceLine) || !isBoundedString(value.kind)) {
    return false;
  }
  return optionalBoundedString(value.timestamp) && optionalBoundedString(value.title) && (value.blocks === undefined || (Array.isArray(value.blocks) && value.blocks.length <= MAX_BLOCKS_PER_ITEM && value.blocks.every(isBlock))) && (value.tool === undefined || isTool(value.tool)) && (value.metadata === undefined || isMetadata(value.metadata)) && (value.omitted === undefined || isOmitted(value.omitted));
}

function isBlock(value: unknown): value is Block {
  return isRecord(value) && hasOnlyKeys(value, ['kind', 'text', 'truncated']) && (value.kind === 'text' || value.kind === 'thinking' || value.kind === 'code') && isBoundedString(value.text) && (value.truncated === undefined || typeof value.truncated === 'boolean');
}

function isTool(value: unknown): value is Tool {
  return isRecord(value) && hasOnlyKeys(value, ['callId', 'name', 'argumentsText', 'resultText', 'isError', 'unmatchedResult', 'truncated']) && isBoundedString(value.name) && optionalBoundedString(value.callId) && optionalBoundedString(value.argumentsText) && optionalBoundedString(value.resultText) && optionalBoolean(value.isError) && optionalBoolean(value.unmatchedResult) && optionalBoolean(value.truncated);
}

function isMetadata(value: unknown): value is Record<string, Scalar> {
  return isRecord(value) && Object.keys(value).length <= MAX_BLOCKS_PER_ITEM && Object.entries(value).every(([key, entry]) => key.length <= 160 && ((typeof entry === 'string' && entry.length <= MAX_HOST_STRING_CHARS) || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))));
}

function isOmitted(value: unknown): value is { reason: string; originalSize?: number } {
  return isRecord(value) && hasOnlyKeys(value, ['reason', 'originalSize']) && isBoundedString(value.reason) && (value.originalSize === undefined || isNonNegativeInteger(value.originalSize));
}

function isDiagnostic(value: unknown): value is Diagnostic {
  return isRecord(value) && hasOnlyKeys(value, ['code', 'severity', 'line', 'message', 'detail']) && isBoundedString(value.code) && (value.severity === 'info' || value.severity === 'warning' || value.severity === 'error') && isBoundedString(value.message) && (value.line === undefined || isNonNegativeInteger(value.line)) && (value.detail === undefined || isDetail(value.detail));
}

function isDetail(value: unknown): value is { count?: number; limit?: number } {
  return isRecord(value) && hasOnlyKeys(value, ['count', 'limit']) && (value.count === undefined || isNonNegativeInteger(value.count)) && (value.limit === undefined || isNonNegativeInteger(value.limit));
}

function isSummary(value: unknown): value is Summary {
  return isRecord(value) && hasOnlyKeys(value, ['sessionId', 'version', 'name', 'cwd', 'activeLeafId', 'pathItemCount', 'hiddenCustomCount']) && (value.version === 1 || value.version === 2 || value.version === 3 || value.version === 'unknown') && isNonNegativeInteger(value.pathItemCount) && isNonNegativeInteger(value.hiddenCustomCount) && optionalBoundedString(value.sessionId) && optionalBoundedString(value.name) && optionalBoundedString(value.cwd) && optionalBoundedString(value.activeLeafId);
}

function isLimits(value: unknown): value is Limits {
  return isRecord(value) && hasExactKeys(value, ['pageItems', 'maxRenderedItems', 'textCharsPerBlock', 'maxDiagnostics']) && isNonNegativeInteger(value.pageItems) && isNonNegativeInteger(value.maxRenderedItems) && isNonNegativeInteger(value.textCharsPerBlock) && isNonNegativeInteger(value.maxDiagnostics) && value.pageItems <= value.maxRenderedItems && value.maxRenderedItems <= 100 && value.textCharsPerBlock <= MAX_HOST_STRING_CHARS && value.maxDiagnostics <= 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && hasOnlyKeys(value, keys);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRevision(value: unknown): value is number {
  return isNonNegativeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_HOST_STRING_CHARS;
}

function optionalBoundedString(value: unknown): boolean {
  return value === undefined || isBoundedString(value);
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}
