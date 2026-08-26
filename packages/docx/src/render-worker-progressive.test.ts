import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLayoutServices } from './layout-runtime.js';
import { layoutSourceStore } from './layout-source-model-adapter.js';
import { retainRenderWorkerDocumentLayout } from './render-worker-layout.js';
import {
  installStubCanvas,
  syntheticDocxModel,
  type SyntheticDocumentShape,
} from './testing/synthetic-document.js';
import { paginateBody } from './layout/body-paginator.js';
import { PaginationAbortError } from './layout/pagination-scheduler.js';
import { layoutFingerprint } from './layout/invariants.js';
import { layoutOptionsForRender } from './layout/options.js';
import { setDocumentLayoutValidation } from './layout/validation-policy.js';
import type { DocumentLayout } from './layout/types.js';
import {
  paginateRenderWorkerDocumentProgressively,
  type RenderWorkerLayoutPublication,
} from './render-worker-progressive.js';

// ─────────────────────────────────────────────────────────────────────────────
// Progressive layout INSIDE the render worker.
//
// Exercised through the same pure seam `render-worker.ts` calls, so none of
// this needs a Worker, an OffscreenCanvas or WASM — the trick
// `progressive-load.test.ts` already uses for the main-thread twin.
//
// The contract being pinned has three parts. Publications must grow, never
// shrink. Each publication must be PRIMED before it is announced, so a
// `renderPage` arriving on the very next task can paint the page it was just
// told about. And the layout left in the store at the end must be exactly the
// one a blocking parse would have produced — because `render-worker.ts` reads
// it straight back through `doc.layoutVariants.defaultLayout` to build the
// authoritative `parsedMeta`.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CURRENT_DATE_MS = 1_700_000_000_000;

function retain(shape: SyntheticDocumentShape, paragraphs: number) {
  const source = layoutSourceStore(syntheticDocxModel(shape, { paragraphs }));
  const services = createLayoutServices(source);
  const retained = retainRenderWorkerDocumentLayout(
    source,
    services,
    DEFAULT_CURRENT_DATE_MS,
  );
  return { source, services, retained };
}

/** Collect publications while recording what the store served at the instant
 *  each one was announced — the "prime before publish" invariant. */
function recordingPublisher(storePageCount: () => number) {
  const publications: RenderWorkerLayoutPublication[] = [];
  const servedAtPublish: number[] = [];
  const progress: number[] = [];
  return {
    publications,
    servedAtPublish,
    progress,
    publisher: {
      publish: (publication: RenderWorkerLayoutPublication) => {
        publications.push(publication);
        servedAtPublish.push(storePageCount());
      },
      progress: (committedPages: number) => { progress.push(committedPages); },
    },
  };
}

beforeAll(() => {
  installStubCanvas();
});

afterAll(() => {
  setDocumentLayoutValidation(true);
});

describe('render worker progressive layout', () => {
  it('primes each prefix before announcing it, and ends on the blocking layout', async () => {
    const { source, retained } = retain('plain', 300);
    const store = retained.layoutVariants;
    const recorder = recordingPublisher(() => store.defaultLayout.pages.length);

    await paginateRenderWorkerDocumentProgressively(
      retained,
      source,
      recorder.publisher,
    );

    expect(recorder.publications.length).toBeGreaterThan(0);
    // Prime-before-publish: the store already served exactly the announced
    // pages when the announcement went out. Anything less would let the host
    // request a page the worker cannot yet lay its hands on.
    recorder.publications.forEach((publication, index) => {
      expect(recorder.servedAtPublish[index]).toBe(publication.pageCount);
      expect(publication.pageSizes).toHaveLength(publication.pageCount);
      // Unbounded paginator lookahead means no truncation cut is provably
      // stable, so every publication is provisional.
      expect(publication.exact).toBe(false);
    });
    // Monotonic: a shrinking page count would jump the viewport under a reader.
    const counts = recorder.publications.map((publication) => publication.pageCount);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);

    // The store is left holding the AUTHORITATIVE layout under the default key,
    // which is what makes `render-worker.ts`'s unchanged
    // `doc.layoutVariants.defaultLayout` a cache hit rather than a second pass.
    const fresh = layoutSourceStore(syntheticDocxModel('plain', { paragraphs: 300 }));
    const blocking = paginateBody(
      fresh.bodyLayoutInput,
      createLayoutServices(fresh),
      layoutOptionsForRender({ defaultCurrentDateMs: DEFAULT_CURRENT_DATE_MS }),
    );
    expect(layoutFingerprint(store.defaultLayout as DocumentLayout))
      .toBe(layoutFingerprint(blocking));
    expect(store.defaultLayout.pages.length)
      .toBeGreaterThan(recorder.publications.at(-1)!.pageCount);
  }, 300_000);

  it('reports progress so a silent worker is distinguishable from a busy one', async () => {
    // The host gives up its request timeout for the duration of a progressive
    // parse, so these are its only liveness evidence between publications.
    const { source, retained } = retain('plain', 300);
    const recorder = recordingPublisher(() => retained.layoutVariants.defaultLayout.pages.length);

    await paginateRenderWorkerDocumentProgressively(retained, source, recorder.publisher);

    expect(recorder.progress.length).toBeGreaterThan(0);
  }, 300_000);

  it('resolves bookmark anchors within the published prefix only', async () => {
    const { source, retained } = retain('plain', 300);
    const recorder = recordingPublisher(() => retained.layoutVariants.defaultLayout.pages.length);

    await paginateRenderWorkerDocumentProgressively(retained, source, recorder.publisher);

    for (const publication of recorder.publications) {
      // A prefix map may be empty, but it may never name a page that prefix
      // does not have — the host resolves internal hyperlinks against this.
      for (const [, pageIndex] of publication.bookmarkPages) {
        expect(pageIndex).toBeLessThan(publication.pageCount);
      }
    }
  }, 300_000);

  it('abandons the drain when the parse is superseded', async () => {
    // A re-parse aborts the previous document's drain. It must stop rather than
    // keep paginating for a document the worker has already dropped.
    const { source, retained } = retain('plain', 300);
    const abort = new AbortController();
    const store = retained.layoutVariants;
    let published = 0;

    const drain = paginateRenderWorkerDocumentProgressively(
      retained,
      source,
      {
        publish: () => { published += 1; abort.abort(); },
        progress: () => {},
      },
      abort.signal,
    );

    await expect(drain).rejects.toBeInstanceOf(PaginationAbortError);
    expect(published).toBe(1);
    // The prefix it managed to prime is still there; nothing half-written.
    expect(store.defaultLayout.pages.length).toBeGreaterThan(0);
  }, 300_000);

  it('still deposits the authoritative layout when no preview is publishable', async () => {
    // A document short enough that previewing is pointless publishes nothing —
    // but the store must still end up primed, or the worker's metadata route
    // would pay for a second full layout.
    const { source, retained } = retain('plain', 6);
    const recorder = recordingPublisher(() => retained.layoutVariants.defaultLayout.pages.length);

    await paginateRenderWorkerDocumentProgressively(retained, source, recorder.publisher);

    expect(recorder.publications).toHaveLength(0);
    expect(retained.layoutVariants.defaultLayout.pages.length).toBeGreaterThan(0);
  }, 300_000);
});
