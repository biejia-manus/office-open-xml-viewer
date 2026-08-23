/**
 * Progressive document layout: paint the first pages long before the whole
 * document has been paginated.
 *
 * ## Why a prefix, and not a partial pass
 *
 * Pagination already commits pages one at a time, so it is tempting to publish
 * those committed pages directly. They are not paintable: a committed page is a
 * pagination draft, and turning drafts into `LayoutPage`s needs the whole-pass
 * composition that follows the block loop (canonical section flow, per-page
 * header/footer stories, endnotes, bookmark starts). That composition consumes
 * the pass's session and allocations, which only exist once the pass ends.
 *
 * So instead of exposing a half-finished pass, this lays out a genuine — just
 * much shorter — document: the first `n` body entries, run through the ordinary
 * `paginateBody`. The result is a complete, fully composed, paintable layout,
 * produced by exactly the code path that produces the real one. Nothing here
 * teaches the engine a second way to build a page.
 *
 * ## Why the preview's last page is dropped
 *
 * Truncating the body removes the lookahead the paginator uses at the cut:
 * `keepNext` keep-sets, widow/orphan control and table continuation all consult
 * blocks that follow. So the FINAL page of a preview may paginate differently
 * from the real document. Earlier pages cannot: nothing downstream of a page
 * boundary can move content back above it, given identical header/footer
 * reserves — and the reserves are identical, because the preview carries the
 * same section and the same header/footer stories.
 *
 * Dropping the last preview page therefore yields pages that match the real
 * layout exactly, for documents without whole-document feedback. Documents WITH
 * such feedback are reported as inexact rather than presented as settled, so a
 * viewer can decide whether to show them at all.
 *
 * ## What is guaranteed
 *
 * The final layout is produced by the ordinary full `paginateBody`, so it is
 * byte-identical to a blocking load. The preview only affects what is on screen
 * BEFORE that finishes.
 */
import type { BodyLayoutInput } from './body-layout-input.js';
import { paginateBody, paginateBodySteps } from './body-paginator.js';
import { drainPaginationAsync, type PaginationSchedulerOptions } from './pagination-scheduler.js';
import type { LayoutOptions } from './options.js';
import type { DocumentLayout, LayoutServices } from './types.js';

/**
 * Body entries laid out for the first preview attempt.
 *
 * Deliberately smaller than a page of ordinary prose. Entry density varies
 * enormously — a dozen paragraphs is a fraction of a page, a dozen tables is
 * several pages — and guessing high is the expensive mistake: a too-large window
 * pays full layout cost for pages nobody asked for, while a too-small one costs
 * one cheap extra attempt.
 */
const INITIAL_PREVIEW_ENTRIES = 12;

/** Growth factor when a preview did not reach {@link ProgressiveLayoutOptions.previewPages}. */
const PREVIEW_GROWTH = 4;

/** Hard ceiling on preview attempts, so a pathological document (one enormous
 *  table, a body of empty paragraphs) cannot spend more time previewing than it
 *  would have spent laying out. */
const MAX_PREVIEW_ATTEMPTS = 3;

export interface ProgressiveLayoutOptions {
  /** Pages the preview should try to publish. Default 2 — enough to fill a
   *  first viewport at typical zoom. */
  readonly previewPages?: number;
  /** Receives the provisional prefix layout, if one could be produced. */
  readonly onPreview?: (preview: ProgressiveLayoutPreview) => void;
  /** Scheduling for the full layout that follows the preview. */
  readonly scheduler?: PaginationSchedulerOptions;
  /**
   * Whether the document has PAGE/NUMPAGES feedback — `LayoutSourceStore.
   * hasPaginationFields`. Supplied by the caller because it is a parsed-source
   * fact, and the layout input alone cannot answer it cheaply.
   */
  readonly hasPaginationFields?: boolean;
}

export interface ProgressiveLayoutPreview {
  /** A complete, paintable layout of the document's opening pages. */
  readonly layout: DocumentLayout;
  /**
   * Whether these pages are known to match the final layout. False when the
   * document has whole-document feedback (PAGE/NUMPAGES fields), in which case
   * page numbering in headers and footers can still change.
   */
  readonly exact: boolean;
  /** Body entries the preview covers, for diagnostics. */
  readonly coveredEntries: number;
}

/**
 * Whether a preview's pages can be trusted to survive into the final layout.
 *
 * PAGE/NUMPAGES fields are the disqualifier: their value depends on the total
 * page count, which a prefix does not know, so a footer reading "Page 1 of 3"
 * would later become "Page 1 of 480". Page-owned anchors and continuous-section
 * column balancing also re-paginate, but they resolve from evidence contained in
 * the pages themselves, so a prefix converges to the same result for the pages
 * it keeps.
 */
function previewIsExact(hasPaginationFields: boolean | undefined): boolean {
  return hasPaginationFields !== true;
}

/** Build the same input restricted to its first `entries` body entries. */
function truncateBodyInput(input: BodyLayoutInput, entries: number): BodyLayoutInput {
  return Object.freeze({
    ...input,
    sequence: Object.freeze(input.sequence.slice(0, entries)),
  });
}

/** Keep at most `limit` leading pages. */
function capPages(layout: DocumentLayout, limit: number): DocumentLayout {
  if (layout.pages.length <= limit) return layout;
  return Object.freeze({
    ...layout,
    pages: Object.freeze(layout.pages.slice(0, limit)),
  }) as DocumentLayout;
}

/** Drop the preview's final page — the only one truncation can have changed. */
function withoutTrailingPage(layout: DocumentLayout): DocumentLayout {
  return Object.freeze({
    ...layout,
    pages: Object.freeze(layout.pages.slice(0, -1)),
  }) as DocumentLayout;
}

/**
 * Lay out the opening pages, hand them to `onPreview`, then lay out the whole
 * document and return it.
 *
 * The returned layout is the authoritative one; the preview is strictly a
 * stopgap for the viewport. When no useful preview can be produced — a document
 * short enough that previewing is pointless, or one whose first attempt yields
 * a single page — `onPreview` simply never fires and this degrades to an
 * ordinary sliced layout.
 */
export async function layoutDocumentProgressively(
  input: BodyLayoutInput,
  services: LayoutServices,
  options: LayoutOptions,
  progressive: ProgressiveLayoutOptions = {},
): Promise<DocumentLayout> {
  const previewPages = Math.max(1, progressive.previewPages ?? 2);
  const { onPreview } = progressive;
  if (onPreview) {
    emitPreview(
      input,
      services,
      options,
      previewPages,
      onPreview,
      progressive.hasPaginationFields,
    );
  }
  return drainPaginationAsync(
    paginateBodySteps(input, services, options),
    progressive.scheduler,
  );
}

function emitPreview(
  input: BodyLayoutInput,
  services: LayoutServices,
  options: LayoutOptions,
  previewPages: number,
  onPreview: (preview: ProgressiveLayoutPreview) => void,
  hasPaginationFields: boolean | undefined,
): void {
  const total = input.sequence.length;
  let entries = INITIAL_PREVIEW_ENTRIES;
  // A document that fits inside the first preview window is not worth
  // previewing: the full layout is about to arrive just as fast.
  if (total <= entries) return;
  for (let attempt = 0; attempt < MAX_PREVIEW_ATTEMPTS; attempt += 1) {
    const covered = Math.min(entries, total);
    if (covered >= total) return;
    let layout: DocumentLayout;
    try {
      layout = paginateBody(truncateBodyInput(input, covered), services, options);
    } catch {
      // A prefix is not a document the engine promised to be able to lay out —
      // a cut can land anywhere, including places the real sequence never
      // presents. Never let that failure reach the caller: the authoritative
      // layout is still coming, and losing the preview only costs latency.
      return;
    }
    // Two pages is the minimum useful result: the trailing one is discarded as
    // untrustworthy, leaving one real page to paint.
    const lastAttempt = attempt === MAX_PREVIEW_ATTEMPTS - 1
      || covered * PREVIEW_GROWTH >= total;
    if (layout.pages.length >= 2 || lastAttempt) {
      // Publishing is capped independently of how many pages the window
      // happened to produce: a dense window can yield far more than the
      // viewport needs, and handing those to the viewer would mean painting
      // pages that the imminent full layout is about to replace anyway.
      const published = capPages(withoutTrailingPage(layout), previewPages);
      if (published.pages.length === 0) return;
      onPreview(Object.freeze({
        layout: published,
        exact: previewIsExact(hasPaginationFields),
        coveredEntries: covered,
      }));
      return;
    }
    entries = covered * PREVIEW_GROWTH;
  }
}
