import type {
  ViewerCommentCardBaseContext,
  ViewerCommentMessage,
  ViewerCommentThread,
  ViewerCommentUiOptions,
} from '@silurus/ooxml-core';
import type { XlsxComment, XlsxCommentReply } from './types.js';

/** XLSX-specific facts supplied in addition to the shared card context. */
export interface XlsxCommentCardContext extends ViewerCommentCardBaseContext {
  readonly comment: Readonly<XlsxComment>;
  readonly replies: readonly Readonly<XlsxCommentReply>[];
  readonly sheetIndex: number;
  readonly sheetName: string;
  readonly cellRef: string;
  /** Close the cell-anchored card without inventing a selection state. */
  readonly dismiss: () => void;
}

/** XLSX uses an anchored hover card rather than a page-side margin, so the
 * shared card/visibility contract applies but page-to-margin decoration does not. */
export type XlsxCommentUiOptions = ViewerCommentUiOptions<XlsxCommentCardContext>;

function message(
  comment: Readonly<XlsxComment | XlsxCommentReply>,
  messageKey: string,
): ViewerCommentMessage {
  return Object.freeze({
    messageKey,
    sourceId: comment.id,
    author: comment.author,
    date: comment.date,
    text: 'rootText' in comment ? (comment.rootText ?? comment.text) : comment.text,
    status: comment.resolved ? 'resolved' : 'active',
  });
}

export function xlsxCommentThread(
  comment: Readonly<XlsxComment>,
  sheetIndex: number,
): ViewerCommentThread {
  const source = comment.id ?? comment.kind ?? 'note';
  const occurrenceKey = `sheet:${sheetIndex}:${source}:${comment.cellRef}`;
  return Object.freeze({
    occurrenceKey,
    root: message(comment, `${occurrenceKey}:root`),
    replies: Object.freeze((comment.replies ?? []).map((reply, index) =>
      message(reply, `${occurrenceKey}:reply:${reply.id || index}`))),
  });
}
