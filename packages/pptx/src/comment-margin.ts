import {
  EMU_PER_PX,
  overlayPercent,
  type PptxCommentDecorationContext,
  type ViewerCommentCardContext,
  type ViewerCommentCardMount,
  type ViewerCommentMessage,
  type ViewerCommentRect,
  type ViewerCommentThreadGeometry,
  type ViewerCommentDecorationMount,
  type ViewerCommentUiOptions,
} from '@silurus/ooxml-core';
import {
  buildReadOnlyCommentMargin,
  type ReadOnlyCommentThread,
} from '@silurus/ooxml-core/internal/read-only-comment-margin';
import { relativeElementRect } from '@silurus/ooxml-core/internal/dom-geometry';
import type { PptxComment, PptxCommentReply } from './types.js';

export interface PptxCommentCardContext extends ViewerCommentCardContext {
  readonly comment: Readonly<PptxComment>;
  readonly replies: readonly Readonly<PptxCommentReply>[];
}

export type PptxCommentCardMount = ViewerCommentCardMount<PptxCommentCardContext>;
export interface PptxCommentUiOptions extends ViewerCommentUiOptions<PptxCommentCardContext> {
  /** Mount connector lines or other transparent slide-to-margin decoration. */
  readonly mountDecoration?: ViewerCommentDecorationMount<PptxCommentDecorationContext>;
}

function commentId(comment: Readonly<PptxComment>, index: number, slideIndex: number): string {
  const source = comment.id ?? `classic:${comment.authorId ?? 'unknown'}:${comment.index ?? index}`;
  return `slide:${slideIndex}:${source}`;
}

function toReplyCard(
  reply: Readonly<PptxCommentReply>,
): ViewerCommentMessage {
  return {
    messageKey: reply.id,
    sourceId: reply.id,
    author: reply.author,
    date: reply.date,
    text: reply.text,
    status: reply.status,
  };
}

export function buildPptxCommentMargin(
  markerLayer: HTMLDivElement,
  margin: HTMLDivElement,
  comments: readonly Readonly<PptxComment>[],
  slideIndex: number,
  slideWidthEmu: number,
  slideHeightEmu: number,
  activeId: string | null,
  onSetActive: (id: string, active: boolean) => void,
  zoom: number,
  mountCard?: PptxCommentCardMount,
  includeResolved = false,
  registerInteractiveRoot?: (root: Node) => () => void,
  onGeometryChange?: () => void,
  onError?: (error: Error) => void,
): readonly ViewerCommentThreadGeometry[] {
  margin.dataset.ooxmlCommentZoom = String(zoom);
  markerLayer.replaceChildren();
  const visible = comments
    .map((comment, index) => ({ comment, index, id: commentId(comment, index, slideIndex) }))
    .filter(({ comment }) => includeResolved ||
      (comment.status !== 'resolved' && comment.status !== 'closed'));
  const anchorRects = new Map<string, ViewerCommentRect>();
  const surface = markerLayer.parentElement;

  for (const [visibleIndex, entry] of visible.entries()) {
    const { comment, id } = entry;
    if (!Number.isFinite(comment.x) || !Number.isFinite(comment.y)) continue;
    const marker = markerLayer.ownerDocument.createElement('button');
    marker.type = 'button';
    marker.dataset.ooxmlCommentId = id;
    marker.setAttribute('aria-label', `Comment ${visibleIndex + 1}`);
    marker.setAttribute('aria-pressed', String(activeId === id));
    const left = Math.max(0, Math.min(comment.x as number, slideWidthEmu));
    const top = Math.max(0, Math.min(comment.y as number, slideHeightEmu));
    marker.style.cssText =
      `position:absolute;transform:translate(-50%,-50%);width:${22 * zoom}px;height:${22 * zoom}px;` +
      `padding:0;border:${2 * zoom}px solid #fff;border-radius:999px;cursor:pointer;pointer-events:auto;` +
      `font:600 ${11 * zoom}px/${18 * zoom}px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;` +
      'color:#fff;background:var(--ooxml-comment-marker-background,#2563eb);' +
      `left:${overlayPercent(left, slideWidthEmu)};top:${overlayPercent(top, slideHeightEmu)};` +
      `box-shadow:${activeId === id ? `0 0 0 ${3 * zoom}px rgba(37,99,235,.35)` : `0 ${zoom}px ${3 * zoom}px rgba(15,23,42,.28)`};`;
    marker.textContent = String(visibleIndex + 1);
    marker.addEventListener('click', () => onSetActive(id, activeId !== id));
    markerLayer.appendChild(marker);
    anchorRects.set(id, Object.freeze({
      x: left / EMU_PER_PX * zoom - 11 * zoom,
      y: top / EMU_PER_PX * zoom - 11 * zoom,
      width: 22 * zoom,
      height: 22 * zoom,
    }));
  }

  const cardThreads: ReadOnlyCommentThread[] = visible.map(({ comment, id }) => ({
    occurrenceKey: id,
    root: {
      messageKey: comment.id,
      sourceId: comment.id,
      author: comment.author,
      date: comment.date,
      text: comment.text,
      status: comment.status,
    },
    replies: comment.replies?.map(toReplyCard) ?? [],
  }));
  const byId = new Map(visible.map((entry) => [entry.id, entry.comment]));
  const cardHosts = buildReadOnlyCommentMargin(margin, cardThreads, {
    activeId,
    zoom,
    onSetActive,
    mountCard,
    registerInteractiveRoot,
    onGeometryChange,
    onError,
    contextFor(thread, common, selection) {
      const comment = byId.get(thread.occurrenceKey);
      if (!comment) {
        throw new Error(`Missing PPTX comment thread for ${thread.occurrenceKey}`);
      }
      return { ...common, ...selection, comment, replies: comment.replies ?? [] };
    },
  });
  return Object.freeze(cardThreads.map((thread): ViewerCommentThreadGeometry => {
    const cardHost = cardHosts.get(thread.occurrenceKey);
    const cardRect = cardHost && surface ? relativeElementRect(cardHost, surface) : undefined;
    const anchorRect = anchorRects.get(thread.occurrenceKey);
    return Object.freeze({
      occurrenceKey: thread.occurrenceKey,
      active: activeId === thread.occurrenceKey,
      anchorRects: Object.freeze(anchorRect ? [anchorRect] : []),
      ...(cardRect ? { cardRect } : {}),
    });
  }));
}
