import { MAX_DIAGNOSTICS } from '../core/index.js';
import type {
  Diagnostic,
  NormalizedSessionModel,
  SessionSummary,
  ViewItem
} from '../core/index.js';

export const PROTOCOL_VERSION = 1 as const;
export const PAGE_ITEMS = 50;
export const MAX_RENDERED_ITEMS = 100;
export const TEXT_CHARS_PER_BLOCK = 32_000;

export interface PublicLimits {
  readonly pageItems: number;
  readonly maxRenderedItems: number;
  readonly textCharsPerBlock: number;
  readonly maxDiagnostics: number;
}

export interface Page {
  readonly start: number;
  readonly total: number;
  readonly items: readonly ViewItem[];
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
}

export type ExtensionToWebview =
  | { readonly protocol: 1; readonly type: 'init'; readonly revision: number; readonly summary: SessionSummary; readonly diagnostics: readonly Diagnostic[]; readonly page: Page; readonly limits: PublicLimits }
  | { readonly protocol: 1; readonly type: 'page'; readonly revision: number; readonly page: Page }
  | { readonly protocol: 1; readonly type: 'error'; readonly revision: number; readonly message: string };

export type WebviewToExtension =
  | { readonly protocol: 1; readonly type: 'ready' }
  | { readonly protocol: 1; readonly type: 'requestPage'; readonly revision: number; readonly direction: 'older' | 'newer'; readonly anchor: number }
  | { readonly protocol: 1; readonly type: 'announce'; readonly revision: number; readonly message: string };

export const PUBLIC_LIMITS: PublicLimits = Object.freeze({
  pageItems: PAGE_ITEMS,
  maxRenderedItems: MAX_RENDERED_ITEMS,
  textCharsPerBlock: TEXT_CHARS_PER_BLOCK,
  maxDiagnostics: MAX_DIAGNOSTICS
});

/** The newest page is the initial conversation window. */
export function latestPage(model: NormalizedSessionModel): Page {
  const total = model.items.length;
  return pageAt(model, Math.floor(Math.max(0, total - 1) / PAGE_ITEMS) * PAGE_ITEMS);
}

export function pageAt(model: NormalizedSessionModel, requestedStart: number): Page {
  const total = model.items.length;
  const lastPageStart = Math.floor(Math.max(0, total - 1) / PAGE_ITEMS) * PAGE_ITEMS;
  const start = Math.min(Math.max(0, requestedStart), lastPageStart);
  const items = model.items.slice(start, Math.min(total, start + PAGE_ITEMS));
  return Object.freeze({
    start,
    total,
    items,
    hasOlder: start > 0,
    hasNewer: start + items.length < total
  });
}

/** Resolves only an adjacent page; invalid/stale callers must be rejected before this function. */
export function adjacentPage(model: NormalizedSessionModel, page: Page, direction: 'older' | 'newer'): Page {
  if (direction === 'older') {
    return pageAt(model, page.hasOlder ? page.start - PAGE_ITEMS : page.start);
  }
  return pageAt(model, page.hasNewer ? page.start + PAGE_ITEMS : page.start);
}

/** Strictly validates untrusted webview messages. Unknown keys and values are rejected. */
export function parseWebviewMessage(value: unknown): WebviewToExtension | undefined {
  if (!isRecord(value) || value.protocol !== PROTOCOL_VERSION || typeof value.type !== 'string') {
    return undefined;
  }
  if (value.type === 'ready' && hasExactKeys(value, ['protocol', 'type'])) {
    return { protocol: 1, type: 'ready' };
  }
  if (value.type === 'requestPage'
    && hasExactKeys(value, ['protocol', 'type', 'revision', 'direction', 'anchor'])
    && isRevision(value.revision)
    && (value.direction === 'older' || value.direction === 'newer')
    && isSafeNonNegativeInteger(value.anchor)) {
    return { protocol: 1, type: 'requestPage', revision: value.revision, direction: value.direction, anchor: value.anchor };
  }
  if (value.type === 'announce'
    && hasExactKeys(value, ['protocol', 'type', 'revision', 'message'])
    && isRevision(value.revision)
    && typeof value.message === 'string'
    && value.message.length <= 160) {
    return { protocol: 1, type: 'announce', revision: value.revision, message: value.message };
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isRevision(value: unknown): value is number {
  return isSafeNonNegativeInteger(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
