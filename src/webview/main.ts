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

const vscode = acquireVsCodeApi();
const appElement = document.getElementById('app');
if (appElement === null) {
  throw new Error('Pi Session Preview root is unavailable.');
}
const app: HTMLElement = appElement;

let revision = -1;
let page: Page | undefined;
let summary: Summary | undefined;
let diagnostics: Diagnostic[] = [];
let limits: Limits | undefined;
let statusText = '';
// VS Code persists only numeric navigation/scroll state when the webview is recreated;
// it never contains session content, diagnostics, or rendered cards.
const savedNavigation = vscode.getState();
const MAX_HOST_STRING_CHARS = 32_000;
const MAX_BLOCKS_PER_ITEM = 64;
const AUTO_FOLLOW_DISTANCE = 96;

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = parseHostMessage(event.data);
  if (message === undefined) {
    return;
  }
  if (message.type === 'error') {
    revision = message.revision;
    page = undefined;
    summary = undefined;
    diagnostics = [];
    renderError(message.message);
    return;
  }
  const scroll = page === undefined ? undefined : captureScroll();
  if (message.type === 'init') {
    revision = message.revision;
    page = message.page;
    summary = message.summary;
    diagnostics = message.diagnostics;
    limits = message.limits;
    statusText = page.total === 0
      ? 'No renderable conversation items.'
      : savedNavigation?.revision === revision && savedNavigation.start === page.start
        ? `Restored ${pageStatus(page).toLowerCase()}`
        : pageStatus(page);
    render(scroll, true);
    return;
  }
  if (message.revision !== revision) {
    return;
  }
  page = message.page;
  statusText = pageStatus(page);
  // Paging is deliberate reader navigation, not an append; keep its offset instead of following.
  render(scroll, false);
});

window.addEventListener('scroll', persistNavigation, { passive: true });
vscode.postMessage({ protocol: 1, type: 'ready' });

function render(previousScroll?: ScrollState, shouldAutoFollow = false): void {
  if (page === undefined || summary === undefined || limits === undefined) {
    return;
  }
  app.replaceChildren();
  app.append(
    renderHeader(summary),
    renderDiagnostics(diagnostics.slice(0, limits.maxDiagnostics)),
    renderTranscript(page),
    renderStatus(statusText)
  );
  restoreScroll(previousScroll, shouldAutoFollow);
}

interface ScrollState {
  readonly top: number;
  readonly nearBottom: boolean;
}

function captureScroll(): ScrollState {
  const root = document.documentElement;
  const top = Math.max(window.scrollY, root.scrollTop, document.body.scrollTop);
  const maximum = Math.max(0, root.scrollHeight - window.innerHeight);
  return { top, nearBottom: maximum - top <= AUTO_FOLLOW_DISTANCE };
}

function restoreScroll(previous: ScrollState | undefined, shouldAutoFollow: boolean): void {
  const savedTop = previous === undefined
    && savedNavigation?.revision === revision
    && savedNavigation.start === page?.start
    && isNonNegativeInteger(savedNavigation.scrollTop)
    ? savedNavigation.scrollTop
    : previous?.top;
  const apply = (): void => {
    const root = document.documentElement;
    const maximum = Math.max(0, root.scrollHeight - window.innerHeight);
    // Follow an external append only for readers who were already at the bottom.
    const target = shouldAutoFollow && previous?.nearBottom === true
      ? maximum
      : Math.min(Math.max(0, savedTop ?? 0), maximum);
    window.scrollTo({ top: target, behavior: 'auto' });
    persistNavigation();
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(apply);
  } else {
    apply();
  }
}

function persistNavigation(): void {
  if (page === undefined) {
    return;
  }
  vscode.setState({
    revision,
    start: page.start,
    scrollTop: Math.max(window.scrollY, document.documentElement.scrollTop, document.body.scrollTop)
  });
}

function renderHeader(value: Summary): HTMLElement {
  const header = element('header', 'session-header');
  const heading = element('h1');
  heading.textContent = value.name === undefined ? 'Pi Session Preview' : `Pi Session Preview: ${value.name}`;
  const facts = element('dl', 'session-facts');
  addFact(facts, 'Format', value.version === 'unknown' ? 'Unknown' : `v${value.version}`);
  addFact(facts, 'Visible cards', String(value.pathItemCount));
  if (value.hiddenCustomCount > 0) {
    addFact(facts, 'Hidden custom messages', String(value.hiddenCustomCount));
  }
  if (value.cwd !== undefined) {
    addFact(facts, 'Working directory', value.cwd);
  }
  header.append(heading, facts);
  return header;
}

function renderDiagnostics(values: readonly Diagnostic[]): HTMLElement {
  const section = element('section', 'diagnostics');
  section.setAttribute('aria-label', 'Session warnings');
  if (values.length === 0) {
    return section;
  }
  const heading = element('h2');
  heading.textContent = 'Session warnings';
  const list = element('ul');
  for (const diagnostic of values) {
    const item = element('li', `diagnostic diagnostic-${diagnostic.severity}`);
    item.textContent = diagnosticText(diagnostic);
    if (diagnostic.severity === 'error') {
      item.setAttribute('role', 'alert');
    }
    list.append(item);
  }
  section.append(heading, list);
  return section;
}

function renderTranscript(value: Page): HTMLElement {
  const section = element('section', 'transcript-section');
  section.id = 'transcript';
  section.tabIndex = -1;
  section.setAttribute('aria-labelledby', 'transcript-title');
  const heading = element('h2');
  heading.id = 'transcript-title';
  heading.textContent = 'Conversation';
  const navigation = renderNavigation(value);
  const list = element('ol', 'transcript');
  list.setAttribute('aria-label', `Conversation cards ${value.start + 1} through ${value.start + value.items.length} of ${value.total}`);
  if (value.items.length === 0) {
    const empty = element('p', 'empty-state');
    empty.textContent = 'No supported conversation content was available. Use the source editor to inspect the JSONL.';
    section.append(heading, navigation, empty);
    return section;
  }
  for (const [index, item] of value.items.slice(0, limits?.maxRenderedItems ?? 100).entries()) {
    const listItem = document.createElement('li');
    listItem.append(renderItem(item, index));
    list.append(listItem);
  }
  section.append(heading, navigation, list);
  return section;
}

function renderNavigation(value: Page): HTMLElement {
  const navigation = element('nav', 'page-navigation');
  navigation.setAttribute('aria-label', 'Conversation pages');
  if (value.hasOlder) {
    navigation.append(pageButton('Load Earlier', 'older', value));
  }
  const position = element('p', 'page-position');
  position.textContent = value.total === 0 ? '0 cards' : `Cards ${value.start + 1}–${value.start + value.items.length} of ${value.total}`;
  navigation.append(position);
  if (value.hasNewer) {
    navigation.append(pageButton('Load Newer', 'newer', value));
  }
  return navigation;
}

function pageButton(label: string, direction: 'older' | 'newer', value: Page): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => {
    vscode.postMessage({ protocol: 1, type: 'requestPage', revision, direction, anchor: value.start });
  });
  return button;
}

function renderItem(item: Item, ordinal: number): HTMLElement {
  const article = element('article', `conversation-card card-${safeClass(item.kind)}`);
  article.setAttribute('aria-labelledby', `card-title-${ordinal}`);
  const header = element('header', 'card-header');
  const title = element('h3');
  title.id = `card-title-${ordinal}`;
  title.textContent = item.title ?? titleFor(item.kind);
  header.append(title);
  if (item.timestamp !== undefined) {
    const formattedTimestamp = formatTimestamp(item.timestamp);
    if (formattedTimestamp !== undefined) {
      const time = element('time', 'timestamp');
      time.textContent = formattedTimestamp;
      header.append(time);
    }
  }
  const line = element('p', 'source-line');
  line.textContent = `Source line ${item.sourceLine}`;
  article.append(header, line);

  const blocks = (item.blocks ?? []).slice(0, MAX_BLOCKS_PER_ITEM);
  if (item.kind === 'compaction' && blocks.length > 0) {
    const details = document.createElement('details');
    details.className = 'compaction';
    const summaryElement = document.createElement('summary');
    summaryElement.textContent = 'Compaction summary';
    details.append(summaryElement);
    for (const block of blocks) {
      details.append(renderBlock(block));
    }
    article.append(details);
  } else {
    for (const block of blocks) {
      article.append(renderBlock(block));
    }
  }
  if (item.tool !== undefined) {
    article.append(renderTool(item.tool));
  }
  if (item.metadata !== undefined && Object.keys(item.metadata).length > 0) {
    article.append(renderMetadata(item.metadata));
  }
  if (item.omitted !== undefined) {
    const omitted = element('p', 'omitted-notice');
    omitted.textContent = `Content omitted: ${item.omitted.reason}${item.omitted.originalSize === undefined ? '' : ` (${item.omitted.originalSize} characters)`}.`;
    article.append(omitted);
  }
  return article;
}

function renderBlock(block: Block): HTMLElement {
  if (block.kind === 'thinking') {
    const details = document.createElement('details');
    details.className = 'thinking';
    const brief = document.createElement('summary');
    brief.textContent = 'Thinking';
    const body = element('div', 'markdown');
    renderMarkdown(body, block.text);
    details.append(brief, body);
    if (block.truncated === true) {
      details.append(truncationNotice());
    }
    return details;
  }
  if (block.kind === 'code') {
    return codeBlock(block.text);
  }
  const body = element('div', 'markdown');
  renderMarkdown(body, block.text);
  if (block.truncated === true) {
    body.append(truncationNotice());
  }
  return body;
}

function renderTool(tool: Tool): HTMLElement {
  const section = element('section', `tool-card${tool.isError === true ? ' tool-error' : ''}`);
  const heading = element('h4');
  heading.textContent = tool.name === 'bash' ? 'Bash execution' : `Tool: ${tool.name}`;
  section.append(heading);
  if (tool.unmatchedResult === true) {
    const notice = element('p', 'omitted-notice');
    notice.textContent = 'Unmatched tool result.';
    section.append(notice);
  }
  if (tool.callId !== undefined) {
    const call = element('p', 'tool-call-id');
    call.textContent = `Call ID: ${tool.callId}`;
    section.append(call);
  }
  if (tool.argumentsText !== undefined) {
    section.append(toolDetails('Arguments', tool.argumentsText, true));
  }
  if (tool.resultText !== undefined) {
    section.append(toolDetails(tool.isError === true ? 'Result (Error)' : 'Result', tool.resultText, tool.resultText.length <= 2_000));
  }
  if (tool.truncated === true) {
    section.append(truncationNotice());
  }
  return section;
}

function toolDetails(label: string, text: string, open: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  details.open = open;
  const summaryElement = document.createElement('summary');
  summaryElement.textContent = label;
  details.append(summaryElement, codeBlock(text));
  return details;
}

function renderMetadata(values: Record<string, Scalar>): HTMLElement {
  const details = document.createElement('details');
  details.className = 'metadata';
  const summaryElement = document.createElement('summary');
  summaryElement.textContent = 'Details';
  const list = element('dl', 'metadata-list');
  for (const [key, value] of Object.entries(values)) {
    addFact(list, key, String(value));
  }
  details.append(summaryElement, list);
  return details;
}

function renderStatus(text: string): HTMLElement {
  const status = element('p', 'screen-reader-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.textContent = text;
  return status;
}

function renderError(message: string): void {
  app.replaceChildren();
  const alert = element('section', 'error-state');
  alert.setAttribute('role', 'alert');
  const heading = element('h1');
  heading.textContent = 'Pi Session Preview unavailable';
  const text = element('p');
  text.textContent = message;
  alert.append(heading, text);
  app.append(alert);
}

/** Minimal DOM-only Markdown: literal HTML, URLs, images, and attributes are never activated. */
function renderMarkdown(target: HTMLElement, text: string): void {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    const fence = /^```([^`]*)$/.exec(line);
    if (fence !== null) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      target.append(codeBlock(code.join('\n'), fence[1]?.trim()));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      const level = Math.min(6, Math.max(3, heading[1]?.length ?? 3));
      const elementHeading = document.createElement(`h${level}`);
      appendInline(elementHeading, heading[2] ?? '');
      target.append(elementHeading);
      index += 1;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        const match = /^\s*[-*+]\s+(.*)$/.exec(lines[index] ?? '');
        if (match === null) {
          break;
        }
        const item = document.createElement('li');
        appendInline(item, match[1] ?? '');
        list.append(item);
        index += 1;
      }
      target.append(list);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const list = document.createElement('ol');
      while (index < lines.length) {
        const match = /^\s*\d+\.\s+(.*)$/.exec(lines[index] ?? '');
        if (match === null) {
          break;
        }
        const item = document.createElement('li');
        appendInline(item, match[1] ?? '');
        list.append(item);
        index += 1;
      }
      target.append(list);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote = document.createElement('blockquote');
      const parts: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        parts.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      const paragraph = document.createElement('p');
      appendInline(paragraph, parts.join('\n'));
      quote.append(paragraph);
      target.append(quote);
      continue;
    }
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index]?.trim() !== '' && !/^(?:```|#{1,6}\s+|\s*[-*+]\s+|\s*\d+\.\s+|>\s?)/.test(lines[index] ?? '')) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    const paragraph = document.createElement('p');
    appendInline(paragraph, paragraphLines.join('\n'));
    target.append(paragraph);
  }
}

function appendInline(target: HTMLElement, text: string): void {
  let remaining = text;
  while (remaining.length > 0) {
    const match = /(`[^`]*`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]*\]\([^)]*\))/.exec(remaining);
    if (match === null || match.index === undefined) {
      target.append(document.createTextNode(remaining));
      return;
    }
    if (match.index > 0) {
      target.append(document.createTextNode(remaining.slice(0, match.index)));
    }
    const token = match[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      target.append(code);
    } else if (token.startsWith('**')) {
      const strong = document.createElement('strong');
      strong.textContent = token.slice(2, -2);
      target.append(strong);
    } else if (token.startsWith('*')) {
      const emphasis = document.createElement('em');
      emphasis.textContent = token.slice(1, -1);
      target.append(emphasis);
    } else {
      const label = /^\[([^\]]*)\]\([^)]*\)$/.exec(token)?.[1] ?? '';
      target.append(document.createTextNode(label), document.createTextNode(' (link omitted)'));
    }
    remaining = remaining.slice(match.index + token.length);
  }
}

function codeBlock(text: string, language?: string): HTMLElement {
  const figure = element('figure', 'code-block');
  if (language !== undefined && language !== '') {
    const caption = element('figcaption');
    caption.textContent = `Code (${language})`;
    figure.append(caption);
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = text;
  pre.append(code);
  figure.append(pre);
  return figure;
}

function truncationNotice(): HTMLElement {
  const notice = element('p', 'omitted-notice');
  notice.textContent = 'Displayed text was truncated by the preview limit.';
  return notice;
}

function addFact(list: HTMLElement, label: string, value: string): void {
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  list.append(term, description);
}

function diagnosticText(diagnostic: Diagnostic): string {
  const line = diagnostic.line === undefined ? '' : `Line ${diagnostic.line}: `;
  const limit = diagnostic.detail?.limit === undefined ? '' : ` (limit ${diagnostic.detail.limit})`;
  return `${diagnostic.severity.toUpperCase()}: ${line}${diagnostic.message}${limit}`;
}

function pageStatus(value: Page): string {
  return `Showing cards ${value.start + 1} through ${value.start + value.items.length} of ${value.total}.`;
}

function titleFor(kind: string): string {
  const titles: Record<string, string> = {
    user: 'User', assistant: 'Assistant', tool: 'Tool', bash: 'Bash execution', compaction: 'Compaction', branchSummary: 'Branch summary', customMessage: 'Custom message', modelChange: 'Model change', thinkingChange: 'Thinking level change', label: 'Label', sessionInfo: 'Session information', unknown: 'Unknown entry'
  };
  return titles[kind] ?? 'Session entry';
}

function formatTimestamp(value: string): string | undefined {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

function element(name: string, className?: string): HTMLElement {
  const result = document.createElement(name);
  if (className !== undefined) {
    result.className = className;
  }
  return result;
}

function safeClass(value: string): string {
  return /^[a-zA-Z0-9_-]{1,40}$/.test(value) ? value : 'unknown';
}

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
