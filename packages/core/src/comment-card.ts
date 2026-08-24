import type { ViewerDomMount } from './dom-mount.js';

/** Format-neutral view model for one read-only OOXML comment message. */
export interface ViewerCommentMessage {
  /** Stable authored identity when the OOXML format provides one. */
  readonly messageKey?: string;
  /** Unmodified source identity, when different from `messageKey`. */
  readonly sourceId?: string;
  readonly author?: string;
  readonly date?: string;
  readonly text: string;
  readonly status?: 'active' | 'resolved' | 'closed';
}

/** Format-neutral view model for one read-only OOXML comment thread. */
export interface ViewerCommentThread {
  /** Viewer-stable key for this occurrence in one loaded file generation. */
  readonly occurrenceKey: string;
  readonly root: ViewerCommentMessage;
  readonly replies: readonly ViewerCommentMessage[];
}

/** Format-neutral card data and lifecycle shared by every viewer. */
export interface ViewerCommentCardBaseContext {
  readonly thread: ViewerCommentThread;
  /** Absolute viewer zoom (`1` is the document's natural CSS size). */
  readonly zoom: number;
  /** Aborted before the card host is recycled or the Viewer is destroyed. */
  readonly signal: AbortSignal;
  /** Keep a Portal, Teleport, or Shadow-root surface inside this card's interaction boundary. */
  readonly registerInteractiveRoot: (root: Node) => () => void;
}

/** Selection interaction used by DOCX and PPTX side-margin cards. */
export interface ViewerCommentCardContext extends ViewerCommentCardBaseContext {
  readonly active: boolean;
  /** Idempotently select or clear this thread. */
  readonly setActive: (active: boolean) => void;
}

/** DOM framework adapter hook. The host stays stable until `destroy()`. */
export type ViewerCommentCardMount<Context extends ViewerCommentCardBaseContext = ViewerCommentCardContext> =
  ViewerDomMount<Context>;
