import type { ViewerDomMount } from './dom-mount.js';

/** Axis-aligned rectangle in a comment surface's CSS-pixel coordinate space. */
export interface ViewerCommentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Display geometry for one visible comment-thread occurrence. */
export interface ViewerCommentThreadGeometry {
  readonly occurrenceKey: string;
  readonly active: boolean;
  readonly anchorRects: readonly ViewerCommentRect[];
  /** Absent while a card has not mounted or cannot yet be measured. */
  readonly cardRect?: ViewerCommentRect;
}

/** Geometry shared by paged and slide comment decorations. */
export interface ViewerCommentDecorationBaseContext {
  /** Changes whenever a different document or presentation is committed. */
  readonly layoutGeneration: number;
  /** Monotonically increases for every geometry publication in the generation. */
  readonly geometryRevision: number;
  readonly zoom: number;
  /** Transparent composite surface containing the page/slide and comment margin. */
  readonly surfaceBounds: ViewerCommentRect;
  /** Page or slide bounds within `surfaceBounds`. */
  readonly contentBounds: ViewerCommentRect;
  readonly threads: readonly ViewerCommentThreadGeometry[];
  /** Aborted before this surface is recycled or its Viewer is destroyed. */
  readonly signal: AbortSignal;
}

/** DOCX page geometry, including progressive-layout completion state. */
export interface DocxCommentDecorationContext extends ViewerCommentDecorationBaseContext {
  readonly format: 'docx';
  readonly pageIndex: number;
  /** False while progressive layout may still revise page ownership or count. */
  readonly layoutComplete: boolean;
}

/** PPTX slide geometry. Slides have authored, stable page ownership. */
export interface PptxCommentDecorationContext extends ViewerCommentDecorationBaseContext {
  readonly format: 'pptx';
  readonly slideIndex: number;
}

export type ViewerCommentDecorationContext =
  | DocxCommentDecorationContext
  | PptxCommentDecorationContext;

/** Mount connector lines or other transparent page-relative comment decoration. */
export type ViewerCommentDecorationMount<
  Context extends ViewerCommentDecorationContext = ViewerCommentDecorationContext,
> = ViewerDomMount<Context>;
