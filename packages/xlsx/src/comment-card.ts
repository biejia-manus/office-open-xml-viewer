import type { ViewerCommentUiOptions } from '@silurus/ooxml-core';

/** XLSX uses an anchored hover card rather than a page-side margin, so the
 * shared visibility contract applies but page-to-margin decoration does not. */
export interface XlsxCommentUiOptions extends ViewerCommentUiOptions {}
