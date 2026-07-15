import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import axe from 'axe-core';
import { JSDOM } from 'jsdom';

import { DEFAULT_PARSE_LIMITS, parsePiSession } from '../../core/parse.js';

type Scalar = string | number | boolean;
type Item = {
  key: string;
  sourceId: string;
  sourceLine: number;
  kind: string;
  timestamp?: string;
  title?: string;
  blocks?: Array<{ kind: 'text' | 'thinking' | 'code'; text: string; truncated?: boolean }>;
  tool?: { callId?: string; name: string; argumentsText?: string; resultText?: string; isError?: boolean; unmatchedResult?: boolean; truncated?: boolean };
  metadata?: Record<string, Scalar>;
  omitted?: { reason: string; originalSize?: number };
};
type Page = { start: number; total: number; items: Item[]; hasOlder: boolean; hasNewer: boolean };

interface Harness {
  readonly dom: JSDOM;
  readonly posted: unknown[];
  readonly states: unknown[];
  readonly scrolls: number[];
  send(value: unknown): void;
  close(): void;
}

const bundle = readFileSync(join(process.cwd(), 'media', 'main.js'), 'utf8');
const limits = { pageItems: 50, maxRenderedItems: 100, textCharsPerBlock: 32_000, maxDiagnostics: 100 };

function item(index: number, overrides: Partial<Item> = {}): Item {
  return {
    key: `item-${index}`,
    sourceId: `source-${index}`,
    sourceLine: index + 1,
    kind: 'assistant',
    title: 'Assistant',
    blocks: [{ kind: 'text', text: `Message ${index}` }],
    ...overrides
  };
}

function page(items: Item[], start = 0, total = items.length): Page {
  return {
    start,
    total,
    items,
    hasOlder: start > 0,
    hasNewer: start + items.length < total
  };
}

function init(value: Page, overrides: Record<string, unknown> = {}): unknown {
  return {
    protocol: 1,
    type: 'init',
    revision: 7,
    summary: { version: 3, name: 'Synthetic session', cwd: '/synthetic', activeLeafId: 'leaf', pathItemCount: value.total, hiddenCustomCount: 1 },
    diagnostics: [{ code: 'malformed-line', severity: 'warning', line: 3, message: 'Recovered from malformed input.' }],
    page: value,
    limits,
    ...overrides
  };
}

function harness(savedState?: unknown): Harness {
  const dom = new JSDOM('<!doctype html><html lang="en"><head><title>Pi Session Preview</title></head><body><a class="skip-link" href="#transcript">Skip to transcript</a><main id="app" tabindex="-1"></main></body></html>', {
    runScripts: 'dangerously',
    url: 'https://webview.invalid/'
  });
  const posted: unknown[] = [];
  const states: unknown[] = [];
  const scrolls: number[] = [];
  let scrollTop = 0;
  Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: (): number => scrollTop });
  Object.assign(dom.window, {
    scrollTo: (options: ScrollToOptions): void => {
      scrollTop = typeof options.top === 'number' ? options.top : scrollTop;
      scrolls.push(scrollTop);
    },
    acquireVsCodeApi: (): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void } => ({
      postMessage: (message: unknown): void => { posted.push(message); },
      getState: (): unknown => savedState,
      setState: (state: unknown): void => { states.push(state); }
    })
  });
  dom.window.eval(bundle);
  return {
    dom,
    posted,
    states,
    scrolls,
    send: (value: unknown): void => {
      const data = typeof value === 'object' && value !== null
        ? dom.window.JSON.parse(JSON.stringify(value)) as unknown
        : value;
      void dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data }));
    },
    close: (): void => dom.window.close()
  };
}

function app(value: Harness): HTMLElement {
  const root = value.dom.window.document.getElementById('app');
  assert(root !== null);
  return root;
}

function text(value: Harness): string {
  return app(value).textContent ?? '';
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

test('renders hostile Markdown and every session-derived value as inert text without resource or command activation', () => {
  const view = harness();
  try {
    const hostile = '<script>window.__executed = true</script><img src="https://attacker.invalid/a.png" onerror="window.__executed = true"><svg onload="window.__executed = true"></svg><iframe src="file:///workspace/secret"></iframe> [javascript](javascript:alert(1)) ![command](command:workbench.action.files.openFile)';
    view.send(init(page([item(0, {
      title: '<button onclick="window.__executed = true">title</button>',
      blocks: [{ kind: 'text', text: hostile }],
      tool: { name: 'bash', argumentsText: 'rm -rf /; command:workbench.action.terminal.runSelectedText', resultText: '<img src="https://attacker.invalid/result">' },
      metadata: { unsafe: 'javascript:alert(1)', path: 'file:///workspace/private' }
    })])));

    assert.equal((view.dom.window as unknown as { __executed?: boolean }).__executed, undefined);
    assert.match(text(view), /<script>window\.__executed = true<\/script>/);
    assert.match(text(view), /javascript \(link omitted\)/);
    assert.match(text(view), /command \(link omitted\)/);
    assert.match(text(view), /rm -rf/);
    assert.equal(app(view).querySelectorAll('script, img, svg, iframe, object, embed, form, style').length, 0);
    assert.equal(app(view).querySelectorAll('a[href], [src], [href^="javascript:"], [href^="command:"]').length, 0);
    for (const node of Array.from(app(view).querySelectorAll('*'))) {
      for (const attribute of node.getAttributeNames()) {
        assert.equal(/^on/i.test(attribute), false, `event attribute ${attribute} was rendered`);
      }
    }
    assert.deepEqual(plain(view.posted), [{ protocol: 1, type: 'ready' }]);
  } finally {
    view.close();
  }
});

test('rejects malformed, prototype-shaped, stale, and over-limit host DTOs without changing the rendered DOM', () => {
  const view = harness();
  try {
    view.send(init(page([item(0)])));
    const before = app(view).innerHTML;
    const prototypeInit = Object.create(init(page([item(1)])) as object);
    const malformed = [
      null,
      [],
      { protocol: 1, type: 'init', revision: 7 },
      { ...(init(page([item(1)])) as object), extra: true },
      prototypeInit,
      init(page([item(1, { blocks: [{ kind: 'text', text: 'x'.repeat(32_001) }] })])),
      init(page([item(1, { blocks: Array.from({ length: 65 }, () => ({ kind: 'text' as const, text: 'x' })) })])),
      init(page([item(1, { tool: { name: 'tool', argumentsText: 'x'.repeat(32_001) } })])),
      init(page([item(1)]), { diagnostics: Array.from({ length: 101 }, () => ({ code: 'x', severity: 'warning', message: 'x' })) }),
      { protocol: 1, type: 'page', revision: 6, page: page([item(1)]) },
      { protocol: 1, type: 'error', revision: 7, message: 'x'.repeat(32_001) }
    ];
    for (const value of malformed) {
      view.send(value);
      assert.equal(app(view).innerHTML, before);
    }
  } finally {
    view.close();
  }
});

test('uses bounded pages, explicit truncation notices, and native pagination controls with no duplicate card window', () => {
  const view = harness();
  try {
    const all = Array.from({ length: 123 }, (_, index) => item(index));
    const finalPage = page(all.slice(100), 100, 123);
    view.send(init(finalPage));
    assert.equal(app(view).querySelectorAll('.transcript > li').length, 23);
    assert.match(text(view), /Cards 101–123 of 123/);
    const earlier = app(view).querySelector<HTMLButtonElement>('button');
    assert(earlier !== null);
    assert.equal(earlier.textContent, 'Load Earlier');
    assert.equal(earlier.getAttribute('aria-label'), null);
    earlier.focus();
    assert.equal(view.dom.window.document.activeElement, earlier);
    earlier.click();
    assert.deepEqual(plain(view.posted.at(-1)), { protocol: 1, type: 'requestPage', revision: 7, direction: 'older', anchor: 100 });

    view.send({ protocol: 1, type: 'page', revision: 7, page: page(all.slice(50, 100), 50, 123) });
    assert.equal(app(view).querySelectorAll('.transcript > li').length, 50);
    assert.match(text(view), /Cards 51–100 of 123/);
    view.send({ protocol: 1, type: 'page', revision: 7, page: page(all.slice(0, 50), 0, 123) });
    assert.equal(app(view).querySelectorAll('.transcript > li').length, 50);
    assert.match(text(view), /Cards 1–50 of 123/);

    view.send(init(page([item(0, {
      blocks: [{ kind: 'text', text: 'x'.repeat(32_000), truncated: true }],
      tool: { name: 'large_tool', argumentsText: 'a'.repeat(32_000), resultText: 'r'.repeat(32_000), truncated: true },
      omitted: { reason: 'large media', originalSize: 64_000 }
    })])));
    assert.equal(app(view).querySelectorAll('article').length, 1);
    assert.equal(app(view).querySelectorAll('pre').length, 2);
    assert.match(text(view), /Displayed text was truncated by the preview limit\./);
    assert.match(text(view), /Content omitted:/, 'omission wording remains explicit when supplied by the projection');
  } finally {
    view.close();
  }
});

test('preserves reader scroll and auto-follows refreshed content only from the bottom', () => {
  const view = harness();
  try {
    Object.defineProperty(view.dom.window, 'innerHeight', { configurable: true, value: 100 });
    Object.defineProperty(view.dom.window.document.documentElement, 'scrollHeight', { configurable: true, value: 1_000 });
    view.send(init(page([item(0)])));
    view.dom.window.scrollTo({ top: 900 });
    view.send(init(page([item(0), item(1)]), { revision: 8 }));
    assert.equal(view.scrolls.at(-1), 900, 'a reader at the bottom follows an append');

    view.dom.window.scrollTo({ top: 120 });
    view.send(init(page([item(0), item(1), item(2)]), { revision: 9 }));
    assert.equal(view.scrolls.at(-1), 120, 'a reader above the bottom keeps their position');
  } finally {
    view.close();
  }
});

test('restores only numeric navigation state and provides semantic landmarks, names, focusable native disclosures, and non-color status text', async () => {
  const view = harness({ revision: 7, start: 0 });
  try {
    view.send(init(page([item(0, {
      kind: 'compaction',
      blocks: [{ kind: 'text', text: 'Compact context' }],
      tool: { name: 'tool', argumentsText: 'arg', resultText: 'result' },
      omitted: { reason: 'media omitted', originalSize: 12 }
    })])));
    const document = view.dom.window.document;
    assert.equal(document.querySelector('main#app'), app(view));
    assert.equal(document.querySelector('.skip-link')?.getAttribute('href'), '#transcript');
    assert.equal(document.querySelector('section#transcript')?.getAttribute('aria-labelledby'), 'transcript-title');
    assert.equal(document.querySelector('.transcript')?.tagName, 'OL');
    assert.equal(document.querySelector('article')?.getAttribute('aria-labelledby')?.startsWith('card-title-'), true);
    assert.equal(new Set(Array.from(document.querySelectorAll('article h3')).map((heading) => heading.id)).size, document.querySelectorAll('article h3').length);
    assert.equal(document.querySelector('[role="status"]')?.getAttribute('aria-live'), 'polite');
    assert.match(text(view), /Restored showing cards 1 through 1 of 1/i);
    assert.match(text(view), /Content omitted: media omitted \(12 characters\)\./);
    assert.deepEqual(plain(view.states.at(-1)), { revision: 7, start: 0, scrollTop: 0 });

    const disclosures = [...document.querySelectorAll<HTMLDetailsElement>('details')];
    assert(disclosures.length >= 2);
    for (const disclosure of disclosures) {
      assert(disclosure.querySelector('summary') !== null);
      for (let index = 0; index < 20; index += 1) {
        disclosure.open = index % 2 === 0;
      }
      assert.equal(disclosure.open, false);
    }

    view.dom.window.eval(axe.source);
    const axeWindow = view.dom.window as unknown as { axe: typeof axe };
    const results = await axeWindow.axe.run(document, { rules: { 'color-contrast': { enabled: false } } });
    assert.deepEqual(plain(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical').map((violation) => violation.id)), []);
  } finally {
    view.close();
  }
});

test('renders the reviewed Pi-export parity fixture in normalized semantic card order without inactive or hidden content', () => {
  const projectionDirectory = join(process.cwd(), 'src', 'test', 'fixtures', 'projection');
  const result = parsePiSession({
    bytes: new Uint8Array(readFileSync(join(projectionDirectory, 'active-branch-content.jsonl'))),
    uriLabel: 'active-branch-content.jsonl',
    limits: DEFAULT_PARSE_LIMITS
  });
  const items = JSON.parse(JSON.stringify(result.model.items)) as Item[];
  const view = harness();
  try {
    view.send(init(page(items), {
      summary: { ...result.model.summary, pathItemCount: items.length }
    }));
    const cardTitles = Array.from(app(view).querySelectorAll('article h3')).map((heading) => heading.textContent);
    assert.deepEqual(cardTitles, items.map((entry) => entry.title));
    assert.match(text(view), /Use the main branch\./);
    assert.match(text(view), /Before the first tool\./);
    assert.match(text(view), /Tool: first_tool/);
    assert.match(text(view), /first result/);
    assert.match(text(view), /Compaction summary/);
    assert.match(text(view), /Visible custom text: <button onclick="run\(\)">not behavior<\/button>\./);
    assert.equal(text(view).includes('This alternate branch must not be displayed.'), false);
    assert.equal(text(view).includes('Hidden custom message.'), false);
  } finally {
    view.close();
  }
});

test('theme, high-contrast, reduced-motion, and focus styles are declared without color-only status cues', () => {
  const css = readFileSync(join(process.cwd(), 'media', 'main.css'), 'utf8');
  assert.match(css, /var\(--vscode-editor-foreground\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /border-color: CanvasText/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline: 2px solid var\(--vscode-focusBorder\)/);
});
