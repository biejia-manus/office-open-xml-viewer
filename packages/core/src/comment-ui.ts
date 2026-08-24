import type {
  ViewerCommentCardBaseContext,
  ViewerCommentCardMount,
} from './comment-card.js';

/** Advanced read-only comment UI customization shared by format viewers. */
export interface ViewerCommentUiOptions<
  Context extends ViewerCommentCardBaseContext = ViewerCommentCardBaseContext,
> {
  /** Include resolved or closed threads. DOCX/PPTX default false; XLSX default true. */
  readonly includeResolved?: boolean;
  /** Replace card contents while the viewer retains placement and lifecycle ownership. */
  readonly mountCard?: ViewerCommentCardMount<Context>;
}
