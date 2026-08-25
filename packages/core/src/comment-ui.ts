/** Visibility policy shared by the built-in read-only comment UIs. */
export interface ViewerCommentUiOptions {
  /** Include resolved or closed threads. DOCX/PPTX default false; XLSX default true. */
  readonly includeResolved?: boolean;
}
