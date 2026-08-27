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
import { attachDocumentLayoutRuntime, documentLayoutRuntimeOf } from './layout/runtime-state.js';
import { layoutFingerprint } from './layout/invariants.js';
import { normalizeLayoutOptions } from './layout/options.js';
import { layoutDocumentProgressively } from './layout/progressive.js';
import { setDocumentLayoutValidation } from './layout/validation-policy.js';
import type { DocumentLayout } from './layout/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// The document-level contract for progressive layout, exercised through the
// same variant-store wiring `DocxDocument.load` uses (via
// `retainRenderWorkerDocumentLayout`) rather than through `load()` itself,
// which needs a Worker and WASM.
//
// What matters here is the handover: while the preview is primed, the store —
// and therefore `pageCount`, `pageSize` and the render path — must serve the
// provisional pages; once the full layout is primed over it, they must serve
// the authoritative ones, and that final layout must equal a blocking build.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_DATE_MS = 1_700_000_000_000;
const DEFAULT_CURRENT_DATE_MS = CURRENT_DATE_MS;

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

beforeAll(() => {
  installStubCanvas();
});

afterAll(() => {
  setDocumentLayoutValidation(true);
});

describe('progressive layout handover', () => {
  it('serves provisional pages, then the authoritative layout', async () => {
    const { source, services, retained } = retain('plain', 300);
    const store = retained.layoutVariants;
    const layoutOptions = normalizeLayoutOptions(undefined, DEFAULT_CURRENT_DATE_MS);

    let previewPageCount = 0;
    const full = await layoutDocumentProgressively(
      source.bodyLayoutInput,
      services,
      layoutOptions,
      {
        onPreview: (preview) => {
          store.prime(layoutOptions, preview.layout);
          // The store now answers with the provisional pages — this is exactly
          // what the viewer paints from before the document is fully laid out.
          previewPageCount = store.defaultLayout.pages.length;
        },
      },
    );

    expect(previewPageCount).toBeGreaterThan(0);
    expect(previewPageCount).toBeLessThan(full.pages.length);
    // Before replacement the store still holds the preview.
    expect(store.defaultLayout.pages.length).toBe(previewPageCount);

    store.replaceIfCurrent(layoutOptions, store.defaultLayout, full);
    expect(store.defaultLayout.pages.length).toBe(full.pages.length);

    const blocking = paginateBody(
      layoutSourceStore(syntheticDocxModel('plain', { paragraphs: 300 })).bodyLayoutInput,
      createLayoutServices(layoutSourceStore(syntheticDocxModel('plain', { paragraphs: 300 }))),
      layoutOptions,
    );
    expect(layoutFingerprint(store.defaultLayout as DocumentLayout))
      .toBe(layoutFingerprint(blocking));
  }, 300_000);

  it('keeps geometry stable across the handover for the pages already shown', async () => {
    // The provisional pages a user has already seen must not move when the real
    // layout lands, or the viewport jumps under them.
    const { source, services, retained } = retain('plain', 300);
    const store = retained.layoutVariants;
    const layoutOptions = normalizeLayoutOptions(undefined, DEFAULT_CURRENT_DATE_MS);

    let previewGeometry: { widthPt: number; heightPt: number }[] = [];
    const full = await layoutDocumentProgressively(
      source.bodyLayoutInput,
      services,
      layoutOptions,
      {
        onPreview: (preview) => {
          store.prime(layoutOptions, preview.layout);
          previewGeometry = preview.layout.pages.map((page) => ({
            widthPt: page.geometry.widthPt,
            heightPt: page.geometry.heightPt,
          }));
        },
      },
    );

    expect(previewGeometry.length).toBeGreaterThan(0);
    previewGeometry.forEach((geometry, index) => {
      expect(full.pages[index]!.geometry.widthPt).toBe(geometry.widthPt);
      expect(full.pages[index]!.geometry.heightPt).toBe(geometry.heightPt);
    });
  }, 300_000);

  it('geometry follows the active variant, not the default one', async () => {
    // A tracked-changes viewer paints the markup layout; its scrollbar, page
    // heights and mount window must be measured against that same layout. The
    // two variants genuinely differ, so reading the default here would size the
    // viewport for a document the user is not looking at.
    const source = layoutSourceStore(syntheticDocxModel('tracked', { paragraphs: 160 }));
    const services = createLayoutServices(source);
    const retained = retainRenderWorkerDocumentLayout(source, services, DEFAULT_CURRENT_DATE_MS);
    const store = retained.layoutVariants;

    const markupOptions = normalizeLayoutOptions(undefined, DEFAULT_CURRENT_DATE_MS, true);
    const markup = await layoutDocumentProgressively(
      source.bodyLayoutInput,
      services,
      markupOptions,
    );
    store.prime(markupOptions, markup);

    const finalOptions = normalizeLayoutOptions(undefined, DEFAULT_CURRENT_DATE_MS, false);
    expect(store.layoutFor(finalOptions).pages.length).not.toBe(markup.pages.length);

    // A host object standing in for DocxDocument's runtime-state wiring.
    const owner = {};
    attachDocumentLayoutRuntime(owner, DEFAULT_CURRENT_DATE_MS);
    const runtime = documentLayoutRuntimeOf(owner);
    expect(runtime.activeLayoutOptions).toBeNull();
    runtime.activeLayoutOptions = markupOptions;
    expect(store.layoutFor(runtime.activeLayoutOptions).pages.length).toBe(markup.pages.length);
  }, 300_000);

  it('only the current layout owner can supersede a primed layout', () => {
    const { services, retained } = retain('plain', 60);
    const store = retained.layoutVariants;
    const layoutOptions = normalizeLayoutOptions(undefined, DEFAULT_CURRENT_DATE_MS);
    const first = { pages: [], diagnostics: [] } as unknown as DocumentLayout;
    const second = {
      pages: [{ geometry: { widthPt: 1, heightPt: 1 } }],
      diagnostics: [],
    } as unknown as DocumentLayout;
    setDocumentLayoutValidation(false);
    try {
      const retainedFirst = store.prime(layoutOptions, first);
      // Ordinary priming must not swap a layout a consumer may be painting.
      store.prime(layoutOptions, second);
      expect(store.defaultLayout.pages.length).toBe(0);
      const retainedSecond = store.replaceIfCurrent(layoutOptions, retainedFirst, second);
      expect(retainedSecond).not.toBeNull();
      expect(store.defaultLayout.pages.length).toBe(1);
      // The first publication's stale token can no longer replace the newer
      // authority, even though both layouts use the same options key.
      expect(store.replaceIfCurrent(layoutOptions, retainedFirst, first)).toBeNull();
      expect(store.defaultLayout.pages.length).toBe(1);
    } finally {
      setDocumentLayoutValidation(true);
    }
    expect(services).toBeDefined();
  });
});
