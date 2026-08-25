/** Shared DOM policy for the built-in read-only comment margin.
 *
 * OOXML defines comment data and anchors but not this UI. Format packages own
 * anchor projection (DOCX text ranges, PPTX slide coordinates); this module
 * owns the deliberately plain, themeable card list. Applications that need a
 * different structure use the format packages' comment and geometry APIs.
 */

export const READ_ONLY_COMMENT_MARGIN_WIDTH_PX = 280;

export interface ReadOnlyCommentMessage {
  readonly messageKey: string;
  readonly sourceId?: string;
  readonly author?: string;
  readonly date?: string;
  readonly text: string;
  readonly status?: 'active' | 'resolved' | 'closed';
}

export interface ReadOnlyCommentThread {
  readonly occurrenceKey: string;
  readonly root: ReadOnlyCommentMessage;
  readonly replies: readonly ReadOnlyCommentMessage[];
}

interface MountedCard {
  readonly item: HTMLDivElement;
  readonly card: HTMLButtonElement;
  readonly onClick: () => void;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  thread: ReadOnlyCommentThread;
  painted: boolean;
  focused: boolean;
  active: boolean;
  onSetActive: (id: string, active: boolean) => void;
}

interface MarginState {
  readonly cards: Map<string, MountedCard>;
  readonly onScroll: () => void;
  resizeObserver?: ResizeObserver;
  onGeometryChange?: () => void;
}

export interface ReadOnlyCommentMarginOptions {
  readonly activeId: string | null;
  readonly zoom: number;
  readonly onSetActive: (id: string, active: boolean) => void;
  /** Called when a card's measured geometry or the margin scroll changes. */
  readonly onGeometryChange?: () => void;
}

const stateByMargin = new WeakMap<HTMLDivElement, MarginState>();

function destroyMountedCard(card: MountedCard, observer?: ResizeObserver): void {
  if (observer && typeof observer.unobserve === 'function') observer.unobserve(card.card);
  card.card.removeEventListener('click', card.onClick);
  card.card.removeEventListener('focus', card.onFocus);
  card.card.removeEventListener('blur', card.onBlur);
  card.item.remove();
}

/** Release built-in card resources before a virtualized margin is pooled. */
export function disposeReadOnlyCommentMargin(margin: HTMLDivElement): void {
  const state = stateByMargin.get(margin);
  stateByMargin.delete(margin);
  for (const card of state?.cards.values() ?? []) {
    destroyMountedCard(card, state?.resizeObserver);
  }
  state?.cards.clear();
  if (state) margin.removeEventListener('scroll', state.onScroll);
  state?.resizeObserver?.disconnect();
  margin.replaceChildren();
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

function sameMessage(left: ReadOnlyCommentMessage, right: ReadOnlyCommentMessage): boolean {
  return left.messageKey === right.messageKey &&
    left.sourceId === right.sourceId &&
    left.author === right.author &&
    left.date === right.date &&
    left.text === right.text &&
    left.status === right.status;
}

function sameThread(left: ReadOnlyCommentThread, right: ReadOnlyCommentThread): boolean {
  return left.occurrenceKey === right.occurrenceKey &&
    sameMessage(left.root, right.root) &&
    left.replies.length === right.replies.length &&
    left.replies.every((reply, index) => sameMessage(reply, right.replies[index]));
}

function appendCommentBody(host: HTMLElement, comment: ReadOnlyCommentMessage, reply: boolean): void {
  const owner = host.ownerDocument;
  const block = createDiv(
    owner,
    `display:flex;align-items:flex-start;gap:var(--ooxml-comment-content-gap,.5em);${reply
      ? 'margin:.55em 0 0 .45em;padding:.08em 0 0 .65em;border-left:.08em solid var(--ooxml-comment-reply-border,rgba(100,116,139,.24));'
      : ''}`,
  );
  block.dataset.ooxmlCommentPart = reply ? 'reply' : 'comment';
  const avatar = createDiv(
    owner,
    `display:var(--ooxml-comment-avatar-display,none);place-items:center;flex:0 0 auto;width:${reply ? '1.8em' : '2.1em'};height:${reply ? '1.8em' : '2.1em'};` +
      'border-radius:var(--ooxml-comment-avatar-radius,.7em);' +
      'background:var(--ooxml-comment-avatar-background,#2563eb);' +
      'color:var(--ooxml-comment-avatar-color,#fff);' +
      'font:700 .72em/1 var(--ooxml-comment-font-family,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);',
  );
  avatar.dataset.ooxmlCommentPart = 'avatar';
  avatar.textContent = (comment.author || 'C').trim().slice(0, 1).toUpperCase();
  const content = createDiv(owner, 'min-width:0;flex:1;');
  const identity = createDiv(owner, 'display:flex;align-items:baseline;gap:.48em;min-width:0;');
  const author = createDiv(
    owner,
    'min-width:0;font:700 .84em/1.3 var(--ooxml-comment-font-family,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);' +
      'color:var(--ooxml-comment-author-color,#0f172a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
  );
  author.dataset.ooxmlCommentPart = 'author';
  author.textContent = comment.author || 'Comment';
  identity.appendChild(author);
  const formattedDate = displayDate(comment.date);
  if (formattedDate) {
    const date = createDiv(
      owner,
      'font:500 .66em/1.35 var(--ooxml-comment-date-font-family,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace);' +
        'color:var(--ooxml-comment-muted-color,#64748b);white-space:nowrap;',
    );
    date.dataset.ooxmlCommentPart = 'date';
    date.textContent = formattedDate;
    date.setAttribute('title', comment.date as string);
    identity.appendChild(date);
  }
  const body = createDiv(
    owner,
    'margin-top:.28em;font:400 .84em/1.45 var(--ooxml-comment-font-family,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);' +
      'color:var(--ooxml-comment-body-color,#334155);white-space:pre-wrap;overflow-wrap:anywhere;',
  );
  body.dataset.ooxmlCommentPart = 'body';
  body.textContent = comment.text;
  content.append(identity, body);
  block.append(avatar, content);
  host.appendChild(block);
}

function paintCard(
  card: HTMLButtonElement,
  thread: ReadOnlyCommentThread,
  active: boolean,
  focused: boolean,
): void {
  card.dataset.ooxmlCommentId = thread.occurrenceKey;
  card.dataset.ooxmlCommentActive = String(active);
  card.setAttribute('aria-pressed', String(active));
  card.style.cssText =
    'display:block;width:100%;box-sizing:border-box;margin:0 0 var(--ooxml-comment-card-gap,.42em);' +
    'padding:var(--ooxml-comment-card-padding,.56em .68em);' +
    `border:${active
      ? 'var(--ooxml-comment-card-active-border,1px solid rgba(37,99,235,.5))'
      : 'var(--ooxml-comment-card-border,1px solid rgba(148,163,184,.34))'};` +
    'border-radius:var(--ooxml-comment-card-radius,.3em);text-align:left;cursor:pointer;font:inherit;outline:none;' +
    `background:${active
      ? 'var(--ooxml-comment-card-active-background,#eff6ff)'
      : 'var(--ooxml-comment-card-background,#fff)'};` +
    `box-shadow:${focused
      ? 'var(--ooxml-comment-card-focus-shadow,inset 0 0 0 .12em rgba(37,99,235,.65))'
      : active
        ? 'var(--ooxml-comment-card-active-shadow,none)'
        : 'var(--ooxml-comment-card-shadow,none)'};`;
  card.replaceChildren();
  appendCommentBody(card, thread.root, false);
  for (const reply of thread.replies) appendCommentBody(card, reply, true);
}

/** Reconcile one built-in margin by occurrence key without replacing card nodes. */
export function buildReadOnlyCommentMargin(
  margin: HTMLDivElement,
  threads: readonly ReadOnlyCommentThread[],
  options: ReadOnlyCommentMarginOptions,
): ReadonlyMap<string, HTMLElement> {
  margin.setAttribute('role', 'list');
  margin.dataset.ooxmlCommentUi = 'margin';
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
    stateByMargin.set(margin, state);
  }
  state.onGeometryChange = options.onGeometryChange;

  const desired = new Set<string>();
  for (const thread of threads) {
    if (desired.has(thread.occurrenceKey)) {
      throw new Error(`Duplicate comment occurrence key: ${thread.occurrenceKey}`);
    }
    desired.add(thread.occurrenceKey);
  }

  for (const [id, mounted] of [...state.cards]) {
    if (!desired.has(id)) {
      state.cards.delete(id);
      destroyMountedCard(mounted, state.resizeObserver);
    }
  }

  for (const thread of threads) {
    let mounted = state.cards.get(thread.occurrenceKey);
    if (!mounted) {
      const item = createDiv(margin.ownerDocument, 'margin:0;padding:0;');
      item.setAttribute('role', 'listitem');
      item.dataset.ooxmlCommentItem = '';
      const card = margin.ownerDocument.createElement('button');
      card.type = 'button';
      card.dataset.ooxmlCommentCard = '';
      const created: MountedCard = {
        item,
        card,
        thread,
        painted: false,
        focused: false,
        active: false,
        onSetActive: options.onSetActive,
        onClick: () => created.onSetActive(thread.occurrenceKey, !created.active),
        onFocus: () => {
          created.focused = true;
          created.card.style.boxShadow =
            'var(--ooxml-comment-card-focus-shadow,inset 0 0 0 .12em rgba(37,99,235,.65))';
        },
        onBlur: () => {
          created.focused = false;
          created.card.style.boxShadow = created.active
            ? 'var(--ooxml-comment-card-active-shadow,none)'
            : 'var(--ooxml-comment-card-shadow,none)';
        },
      };
      card.addEventListener('click', created.onClick);
      card.addEventListener('focus', created.onFocus);
      card.addEventListener('blur', created.onBlur);
      item.appendChild(card);
      state.cards.set(thread.occurrenceKey, created);
      state.resizeObserver?.observe(card);
      mounted = created;
    }
    const active = options.activeId === thread.occurrenceKey;
    mounted.onSetActive = options.onSetActive;
    if (!mounted.painted || mounted.active !== active || !sameThread(mounted.thread, thread)) {
      paintCard(mounted.card, thread, active, mounted.focused);
    }
    mounted.painted = true;
    mounted.active = active;
    mounted.thread = thread;
  }

  const orderedItems = threads.flatMap((thread) => {
    const mounted = state.cards.get(thread.occurrenceKey);
    return mounted ? [mounted.item] : [];
  });
  const orderChanged = orderedItems.length !== margin.children.length ||
    orderedItems.some((item, index) => margin.children[index] !== item);
  if (orderChanged) margin.replaceChildren(...orderedItems);

  return new Map(
    threads.flatMap((thread) => {
      const mounted = state.cards.get(thread.occurrenceKey);
      return mounted ? [[thread.occurrenceKey, mounted.card] as const] : [];
    }),
  );
}
