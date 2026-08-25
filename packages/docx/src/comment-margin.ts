import {
  overlayPercent,
  type ViewerCommentUiOptions,
} from '@silurus/ooxml-core';
import {
  buildReadOnlyCommentMargin,
  type ReadOnlyCommentMessage,
  type ReadOnlyCommentThread,
} from '@silurus/ooxml-core/internal/read-only-comment-margin';
import type {
  ReadOnlyCommentRect,
  ReadOnlyCommentThreadGeometry,
} from '@silurus/ooxml-core/internal/read-only-comment-decoration';
import {
  intersectElementRects,
  relativeElementRect,
} from '@silurus/ooxml-core/internal/dom-geometry';
import { resolveCommentAnchorRuns, type CommentAnchorRange } from './comments.js';
import type { DocxTextRunInfo } from './renderer.js';
import type { DocComment } from './types.js';

interface CommentThread {
  readonly root: DocComment;
  readonly replies: readonly DocComment[];
}

export interface DocxCommentMarginModel {
  readonly comments: readonly DocComment[];
  readonly anchors: readonly CommentAnchorRange[];
}

export interface DocxCommentUiOptions extends ViewerCommentUiOptions {}

function commentThreads(comments: readonly DocComment[], includeResolved: boolean): CommentThread[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  const roots = comments.filter((comment) => comment.parentId === undefined);
  const replies = new Map<string, DocComment[]>();
  for (const comment of comments) {
    if (comment.parentId === undefined) continue;
    let current = comment;
    const seen = new Set<string>([current.id]);
    while (current.parentId !== undefined) {
      const parent = byId.get(current.parentId);
      if (!parent || seen.has(parent.id)) {
        current = comment;
        break;
      }
      seen.add(parent.id);
      current = parent;
    }
    if (current.parentId !== undefined || current === comment) continue;
    const list = replies.get(current.id) ?? [];
    if (!replies.has(current.id)) replies.set(current.id, list);
    list.push(comment);
  }
  return roots
    .filter((root) => includeResolved || root.resolved !== true)
    .map((root) => ({ root, replies: Object.freeze(replies.get(root.id) ?? []) }));
}

function toMessage(comment: DocComment, occurrenceKey: string, index: number): ReadOnlyCommentMessage {
  return {
    messageKey: index === 0
      ? `${occurrenceKey}:root`
      : `${occurrenceKey}:reply:${comment.id || index - 1}`,
    sourceId: comment.id,
    author: comment.author,
    date: comment.date,
    text: comment.paragraphs?.join('\n') ?? comment.text,
    status: comment.resolved ? 'resolved' : 'active',
  };
}

function createTint(
  layer: HTMLDivElement,
  run: Readonly<DocxTextRunInfo>,
  cssWidth: number,
  cssHeight: number,
  active: boolean,
): HTMLDivElement {
  const tint = layer.ownerDocument.createElement('div');
  tint.style.cssText =
    'position:absolute;pointer-events:none;' +
    `left:${overlayPercent(run.x, cssWidth)};top:${overlayPercent(run.y, cssHeight)};` +
    `width:${overlayPercent(run.w, cssWidth)};height:${overlayPercent(run.h, cssHeight)};` +
    `background:${active
      ? 'var(--ooxml-comment-highlight-active,rgba(37,99,235,.34))'
      : 'var(--ooxml-comment-highlight,rgba(59,130,246,.18))'};`;
  tint.dataset.ooxmlCommentHighlight = '';
  tint.dataset.ooxmlCommentActive = String(active);
  if (run.transform) {
    tint.style.transform = run.transform;
    tint.style.transformOrigin = 'top left';
  }
  layer.appendChild(tint);
  return tint;
}

/** Fill the whitespace between consecutive anchor runs on one rendered line.
 * Exact line geometry and transform equality are the boundary: this never uses
 * a proximity threshold and never joins different baselines or transforms. */
function mergeSameLineRuns(
  runs: readonly Readonly<DocxTextRunInfo>[],
): Readonly<DocxTextRunInfo>[] {
  const merged: DocxTextRunInfo[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.y === run.y &&
      previous.h === run.h &&
      previous.transform === run.transform
    ) {
      const left = Math.min(previous.x, run.x);
      const right = Math.max(previous.x + previous.w, run.x + run.w);
      merged[merged.length - 1] = { ...previous, x: left, w: right - left };
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

/** Build one page's range tint and authored-order margin cards. A thread card is
 * emitted on the page containing its first structural anchor; later ranges are
 * still tinted but do not duplicate the card. */
export function buildDocxCommentMargin(
  tintLayer: HTMLDivElement,
  margin: HTMLDivElement,
  runs: readonly Readonly<DocxTextRunInfo>[],
  model: DocxCommentMarginModel,
  cssWidth: number,
  cssHeight: number,
  activeId: string | null,
  onSetActive: (id: string, active: boolean) => void,
  zoom: number,
  includeResolved = false,
  onGeometryChange?: () => void,
): readonly ReadOnlyCommentThreadGeometry[] {
  margin.dataset.ooxmlCommentZoom = String(zoom);
  tintLayer.innerHTML = '';
  const threads = commentThreads(model.comments, includeResolved);
  const firstAnchor = new Map<string, CommentAnchorRange>();
  const anchorRects = new Map<string, ReadOnlyCommentRect[]>();
  const surface = tintLayer.parentElement;
  for (const anchor of model.anchors) {
    if (!firstAnchor.has(anchor.commentId)) firstAnchor.set(anchor.commentId, anchor);
    const active = activeId === anchor.commentId;
    for (const run of mergeSameLineRuns(resolveCommentAnchorRuns(anchor, runs))) {
      const tint = createTint(tintLayer, run, cssWidth, cssHeight, active);
      const rect = run.transform && surface
        ? relativeElementRect(tint, surface)
        : Object.freeze({ x: run.x, y: run.y, width: run.w, height: run.h });
      const list = anchorRects.get(anchor.commentId) ?? [];
      if (!anchorRects.has(anchor.commentId)) anchorRects.set(anchor.commentId, list);
      list.push(rect ?? Object.freeze({ x: run.x, y: run.y, width: run.w, height: run.h }));
    }
  }
  const cardThreads = threads.flatMap((thread): ReadOnlyCommentThread[] => {
    const anchor = firstAnchor.get(thread.root.id);
    if (!anchor || resolveCommentAnchorRuns(anchor, runs).length === 0) return [];
    return [{
      occurrenceKey: thread.root.id,
      root: toMessage(thread.root, thread.root.id, 0),
      replies: thread.replies.map((reply, index) => toMessage(reply, thread.root.id, index + 1)),
    }];
  });
  const cardHosts = buildReadOnlyCommentMargin(margin, cardThreads, {
    activeId,
    zoom,
    onSetActive,
    onGeometryChange,
  });
  const marginRect = surface ? relativeElementRect(margin, surface) : undefined;
  return Object.freeze(cardThreads.map((thread): ReadOnlyCommentThreadGeometry => {
    const cardHost = cardHosts.get(thread.occurrenceKey);
    const measuredCardRect = cardHost && surface
      ? relativeElementRect(cardHost, surface)
      : undefined;
    const cardRect = measuredCardRect && marginRect
      ? intersectElementRects(measuredCardRect, marginRect)
      : undefined;
    return Object.freeze({
      occurrenceKey: thread.occurrenceKey,
      active: activeId === thread.occurrenceKey,
      anchorRects: Object.freeze(anchorRects.get(thread.occurrenceKey) ?? []),
      ...(cardRect ? { cardRect } : {}),
    });
  }));
}
