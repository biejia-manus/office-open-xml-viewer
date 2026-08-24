/** Shared DOM policy for the built-in read-only comment margin.
 *
 * OOXML defines comment data and anchors but not this UI. Format packages own
 * anchor projection (DOCX text ranges, PPTX slide coordinates); this module
 * owns only the accessible card list and its mount lifecycle.
 */

import type {
  ViewerCommentCardBaseContext,
  ViewerSelectableCommentCardContext,
  ViewerCommentCardMount,
  ViewerCommentMessage,
  ViewerCommentThread,
} from '../comment-card.js';
import type { ViewerDomMountHandle } from '../dom-mount.js';

export const READ_ONLY_COMMENT_MARGIN_WIDTH_PX = 280;

export type ReadOnlyCommentThread = ViewerCommentThread;
export type ReadOnlyCommentCardContext = ViewerSelectableCommentCardContext;
export type ReadOnlyCommentCardMount<Context extends ViewerCommentCardBaseContext = ViewerSelectableCommentCardContext> =
  ViewerCommentCardMount<Context>;

interface MountedCard {
  readonly item: HTMLDivElement;
  readonly host: HTMLDivElement;
  readonly abort: AbortController;
  readonly unregisterRoots: Set<() => void>;
  readonly mount: unknown;
  readonly handle: ViewerDomMountHandle<ViewerCommentCardBaseContext>;
}

interface MarginState {
  readonly cards: Map<string, MountedCard>;
  readonly onScroll: () => void;
  resizeObserver?: ResizeObserver;
  onGeometryChange?: () => void;
  onError?: (error: Error) => void;
}

export interface ReadOnlyCommentMarginOptions<Context extends ViewerCommentCardBaseContext> {
  readonly activeId: string | null;
  readonly zoom: number;
  readonly onSetActive: (id: string, active: boolean) => void;
  readonly mountCard?: ReadOnlyCommentCardMount<Context>;
  readonly contextFor?: (
    thread: ReadOnlyCommentThread,
    common: ViewerCommentCardBaseContext,
    selection: Pick<ViewerSelectableCommentCardContext, 'active' | 'setActive'>,
  ) => Context;
  readonly registerInteractiveRoot?: (root: Node) => () => void;
  /** Called when mounted card geometry or the margin scroll position changes. */
  readonly onGeometryChange?: () => void;
  readonly onError?: (error: Error) => void;
}

const stateByMargin = new WeakMap<HTMLDivElement, MarginState>();

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function reportErrors(errors: readonly unknown[], onError?: (error: Error) => void): void {
  if (errors.length === 0) return;
  const normalized = errors.map(asError);
  const error = normalized.length === 1
    ? normalized[0] as Error
    : new AggregateError(normalized, 'Multiple comment card lifecycle operations failed');
  if (onError) {
    try {
      onError(error);
    } catch (callbackError) {
      console.error('[ooxml] comment UI error handler failed:', callbackError);
    }
    return;
  }
  throw error;
}

function destroyMountedCard(card: MountedCard, observer?: ResizeObserver): unknown[] {
  const errors: unknown[] = [];
  if (observer && typeof observer.unobserve === 'function') observer.unobserve(card.host);
  card.abort.abort();
  for (const unregister of [...card.unregisterRoots]) {
    card.unregisterRoots.delete(unregister);
    try {
      unregister();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    card.handle.destroy();
  } catch (error) {
    errors.push(error);
  }
  card.item.remove();
  return errors;
}

/** Release consumer-owned card resources before a virtualized margin is pooled. */
export function disposeReadOnlyCommentMargin(margin: HTMLDivElement): void {
  const state = stateByMargin.get(margin);
  stateByMargin.delete(margin);
  const errors: unknown[] = [];
  for (const card of state?.cards.values() ?? []) {
    errors.push(...destroyMountedCard(card, state?.resizeObserver));
  }
  state?.cards.clear();
  if (state) margin.removeEventListener('scroll', state.onScroll);
  state?.resizeObserver?.disconnect();
  margin.replaceChildren();
  reportErrors(errors, state?.onError);
}

function createDiv(owner: Document, cssText: string): HTMLDivElement {
  const element = owner.createElement('div');
  element.style.cssText = cssText;
  return element;
}

function displayDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(instant);
}

function appendCommentBody(host: HTMLElement, comment: ViewerCommentMessage, reply: boolean): void {
  const owner = host.ownerDocument;
  const block = createDiv(
    owner,
    `display:flex;gap:.65em;${reply ? 'margin:.78em 0 0;padding-top:.72em;border-top:.08em solid rgba(100,116,139,.2);' : ''}`,
  );
  block.dataset.ooxmlCommentPart = reply ? 'reply' : 'comment';
  const avatar = createDiv(
    owner,
    `display:grid;place-items:center;flex:0 0 auto;width:${reply ? '1.8em' : '2.3em'};height:${reply ? '1.8em' : '2.3em'};` +
      'border-radius:.7em;background:#2563eb;color:#fff;font:700 .72em/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
  );
  avatar.dataset.ooxmlCommentPart = 'avatar';
  avatar.textContent = (comment.author || 'C').trim().slice(0, 1).toUpperCase();
  const content = createDiv(owner, 'min-width:0;flex:1;');
  const identity = createDiv(owner, 'min-width:0;');
  const author = createDiv(
    owner,
    'min-width:0;font:700 .96em/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  );
  author.dataset.ooxmlCommentPart = 'author';
  author.textContent = comment.author || 'Comment';
  identity.appendChild(author);
  const formattedDate = displayDate(comment.date);
  if (formattedDate) {
    const date = createDiv(
      owner,
      'margin-top:.08em;font:500 .72em/1.35 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
        'color:#64748b;white-space:nowrap;',
    );
    date.dataset.ooxmlCommentPart = 'date';
    date.textContent = formattedDate;
    date.setAttribute('title', comment.date as string);
    identity.appendChild(date);
  }
  const body = createDiv(
    owner,
    'margin-top:.62em;font:400 .92em/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
      'color:#334155;white-space:pre-wrap;overflow-wrap:anywhere;',
  );
  body.dataset.ooxmlCommentPart = 'body';
  body.textContent = comment.text;
  content.append(identity, body);
  block.append(avatar, content);
  host.appendChild(block);
}

function mountDefaultCard(
  host: HTMLElement,
  initialContext: ViewerSelectableCommentCardContext,
): ViewerDomMountHandle<ViewerSelectableCommentCardContext> {
  const card = host.ownerDocument.createElement('button');
  card.type = 'button';
  let context = initialContext;
  let focused = false;

  const activeShadow = 'inset 0 0 0 .12em rgba(37,99,235,.42)';
  const inactiveShadow = '0 .08em .16em rgba(15,23,42,.12)';
  const paint = (): void => {
    card.dataset.ooxmlCommentId = context.thread.occurrenceKey;
    card.setAttribute('aria-pressed', String(context.active));
    card.style.cssText =
      'display:block;width:100%;box-sizing:border-box;margin:0 0 .62em;padding:.78em .92em;' +
      'border:0;border-radius:.62em;text-align:left;cursor:pointer;font:inherit;outline:none;' +
      `background:${context.active ? 'var(--ooxml-comment-card-active-background,#dbeafe)' : 'var(--ooxml-comment-card-background,#fff)'};` +
      `box-shadow:${focused || context.active ? activeShadow : inactiveShadow};`;
    card.replaceChildren();
    appendCommentBody(card, context.thread.root, false);
    for (const reply of context.thread.replies) appendCommentBody(card, reply, true);
  };
  const onClick = (): void => context.setActive(!context.active);
  const onFocus = (): void => {
    focused = true;
    card.style.boxShadow = activeShadow;
  };
  const onBlur = (): void => {
    focused = false;
    card.style.boxShadow = context.active ? activeShadow : inactiveShadow;
  };
  card.addEventListener('click', onClick);
  card.addEventListener('focus', onFocus);
  card.addEventListener('blur', onBlur);
  host.appendChild(card);
  paint();
  return {
    update(next) {
      context = next;
      paint();
    },
    destroy() {
      card.removeEventListener('click', onClick);
      card.removeEventListener('focus', onFocus);
      card.removeEventListener('blur', onBlur);
    },
  };
}

const defaultCardMount: ViewerCommentCardMount<ViewerSelectableCommentCardContext> = mountDefaultCard;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null &&
    'then' in value && typeof (value as { then?: unknown }).then === 'function';
}

function isMountHandle<Context>(value: unknown): value is ViewerDomMountHandle<Context> {
  return typeof value === 'object' && value !== null &&
    typeof (value as { update?: unknown }).update === 'function' &&
    typeof (value as { destroy?: unknown }).destroy === 'function';
}

function registerRoot(
  root: Node,
  unregisterRoots: Set<() => void>,
  registerInteractiveRoot?: (root: Node) => () => void,
): () => void {
  const unregister = registerInteractiveRoot?.(root) ?? (() => {});
  let registered = true;
  const dispose = (): void => {
    if (!registered) return;
    registered = false;
    unregisterRoots.delete(dispose);
    unregister();
  };
  unregisterRoots.add(dispose);
  return dispose;
}

/** Reconcile one read-only margin by occurrence key. Card hosts and framework
 * roots remain stable across active-state, zoom, and geometry updates. */
export function buildReadOnlyCommentMargin<Context extends ViewerCommentCardBaseContext>(
  margin: HTMLDivElement,
  threads: readonly ReadOnlyCommentThread[],
  options: ReadOnlyCommentMarginOptions<Context>,
): ReadonlyMap<string, HTMLElement> {
  margin.setAttribute('role', 'list');
  margin.dataset.ooxmlCommentZoom = String(options.zoom);
  let state = stateByMargin.get(margin);
  if (!state) {
    const created: MarginState = {
      cards: new Map<string, MountedCard>(),
      onScroll: () => created.onGeometryChange?.(),
      onGeometryChange: options.onGeometryChange,
    };
    const ResizeObserverClass = margin.ownerDocument.defaultView?.ResizeObserver ??
      globalThis.ResizeObserver;
    if (ResizeObserverClass) {
      created.resizeObserver = new ResizeObserverClass(() => created.onGeometryChange?.());
    }
    margin.addEventListener('scroll', created.onScroll, { passive: true });
    state = created;
  }
  state.onGeometryChange = options.onGeometryChange;
  state.onError = options.onError;
  stateByMargin.set(margin, state);

  const desired = new Set<string>();
  for (const thread of threads) {
    if (desired.has(thread.occurrenceKey)) {
      const cleanupErrors: unknown[] = [];
      for (const mounted of state.cards.values()) {
        cleanupErrors.push(...destroyMountedCard(mounted, state.resizeObserver));
      }
      state.cards.clear();
      margin.replaceChildren();
      reportErrors([
        new Error(`Duplicate comment occurrence key: ${thread.occurrenceKey}`),
        ...cleanupErrors,
      ], options.onError);
      return new Map();
    }
    desired.add(thread.occurrenceKey);
  }

  const errors: unknown[] = [];
  for (const [id, mounted] of [...state.cards]) {
    const expectedMount = options.mountCard ?? defaultCardMount;
    if (!desired.has(id) || mounted.mount !== expectedMount) {
      state.cards.delete(id);
      errors.push(...destroyMountedCard(mounted, state.resizeObserver));
    }
  }

  for (const thread of threads) {
    let mounted = state.cards.get(thread.occurrenceKey);
    const mount = (options.mountCard ?? defaultCardMount) as ViewerCommentCardMount<Context>;
    if (!mounted) {
      const item = createDiv(margin.ownerDocument, 'margin:0;padding:0;');
      item.setAttribute('role', 'listitem');
      const host = createDiv(margin.ownerDocument, 'display:block;width:100%;box-sizing:border-box;');
      host.dataset.ooxmlCommentId = thread.occurrenceKey;
      item.appendChild(host);
      // Frameworks may require a connected host during mount. Insert before
      // invoking consumer code and roll the item back if mounting fails.
      margin.appendChild(item);
      const abort = new AbortController();
      const unregisterRoots = new Set<() => void>();
      const common: ViewerCommentCardBaseContext = {
        thread,
        zoom: options.zoom,
        signal: abort.signal,
        registerInteractiveRoot: (root) =>
          registerRoot(root, unregisterRoots, options.registerInteractiveRoot),
      };
      let result: unknown;
      try {
        const selection = {
          active: options.activeId === thread.occurrenceKey,
          setActive: (active: boolean) => options.onSetActive(thread.occurrenceKey, active),
        };
        const context = options.contextFor?.(thread, common, selection) ??
          { ...common, ...selection } as unknown as Context;
        result = mount(host, context);
        if (isPromiseLike(result)) {
          throw new TypeError(
            'commentUi.mountCard must return synchronously; start async work from the supplied AbortSignal',
          );
        }
        if (!isMountHandle<Context>(result)) {
          throw new TypeError('commentUi.mountCard must return an object with update() and destroy()');
        }
      } catch (error) {
        abort.abort();
        for (const unregister of [...unregisterRoots]) {
          unregisterRoots.delete(unregister);
          try {
            unregister();
          } catch (cleanupError) {
            errors.push(cleanupError);
          }
        }
        item.remove();
        errors.push(error);
        continue;
      }
      mounted = {
        item,
        host,
        abort,
        unregisterRoots,
        mount,
        handle: result as unknown as ViewerDomMountHandle<ViewerCommentCardBaseContext>,
      };
      state.cards.set(thread.occurrenceKey, mounted);
      state.resizeObserver?.observe(host);
    } else {
      const existing = mounted;
      const common: ViewerCommentCardBaseContext = {
        thread,
        zoom: options.zoom,
        signal: existing.abort.signal,
        registerInteractiveRoot: (root) =>
          registerRoot(root, existing.unregisterRoots, options.registerInteractiveRoot),
      };
      try {
        const selection = {
          active: options.activeId === thread.occurrenceKey,
          setActive: (active: boolean) => options.onSetActive(thread.occurrenceKey, active),
        };
        const context = options.contextFor?.(thread, common, selection) ??
          { ...common, ...selection } as unknown as Context;
        existing.handle.update(context);
      } catch (error) {
        errors.push(error);
      }
    }
    margin.appendChild(mounted.item);
  }
  reportErrors(errors, options.onError);
  return new Map(
    threads.flatMap((thread) => {
      const mounted = state.cards.get(thread.occurrenceKey);
      return mounted ? [[thread.occurrenceKey, mounted.host] as const] : [];
    }),
  );
}
