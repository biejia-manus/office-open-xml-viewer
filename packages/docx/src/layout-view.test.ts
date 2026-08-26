import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLayoutServices } from './layout-runtime.js';
import { layoutSourceStore } from './layout-source-model-adapter.js';
import { attachDocumentLayoutVariants } from './layout/document-layout-variants.js';
import { layoutDocumentInput } from './layout/document.js';
import { normalizeLayoutOptions, type LayoutOptions } from './layout/options.js';
import { layoutDocumentProgressively } from './layout/progressive.js';
import { setDocumentLayoutValidation } from './layout/validation-policy.js';
import {
  installStubCanvas,
  syntheticDocxModel,
  type SyntheticDocumentShape,
} from './testing/synthetic-document.js';

// ─────────────────────────────────────────────────────────────────────────────
// A layout variant is keyed by its acquisition inputs — today, the resolved
// `currentDate`. The bug this pins: loading a document that will be RENDERED
// with an explicit date used to prime the DEFAULT-dated layout, so the first
// render missed the cache and repaginated the whole document synchronously on
// the main thread — the progressive prefix was never selected at all, and a
// large document froze for seconds before its first page appeared.
//
// The guarantee is expressed as a builder spy: loading for a given variant must
// build that variant and no other. Counting builds is the only way to state it,
// since a wrong-variant build is invisible in the output — it is correct, just
// enormously expensive and thrown away.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_DATE_MS = 1_700_000_000_000;

/** A variant store whose builder records which options it was asked for. */
function spyStore(shape: SyntheticDocumentShape, paragraphs: number) {
  const source = layoutSourceStore(syntheticDocxModel(shape, { paragraphs }));
  const services = createLayoutServices(source);
  const builds: LayoutOptions[] = [];
  const { store } = attachDocumentLayoutVariants({
    source,
    services,
    defaultCurrentDateMs: CURRENT_DATE_MS,
    buildLayout: (options) => {
      builds.push(options);
      return layoutDocumentInput(source.bodyLayoutInput, services, options);
    },
  });
  return { source, services, store, builds };
}

const datedOptions = normalizeLayoutOptions(new Date(CURRENT_DATE_MS + 86_400_000), CURRENT_DATE_MS);
const defaultOptions = normalizeLayoutOptions(undefined, CURRENT_DATE_MS);

beforeAll(() => {
  installStubCanvas();
});

afterAll(() => {
  setDocumentLayoutValidation(true);
});

describe('progressive layout builds only the variant being viewed', () => {
  it('never builds the default variant when loading for a dated one', async () => {
    const { source, services, store, builds } = spyStore('tracked', 200);

    // What `DocxDocument.load({ progressiveLayout, currentDate })` does: prime
    // the preview, then the full layout, both under the DATED key.
    const full = await layoutDocumentProgressively(
      source.bodyLayoutInput,
      services,
      datedOptions,
      {
        hasPaginationFields: source.hasPaginationFields,
        onPreview: (preview) => { store.prime(datedOptions, preview.layout); },
      },
    );
    store.prime(datedOptions, full, true);

    // Rendering a page at that date must hit the primed layout.
    const selected = store.select(datedOptions);
    expect(selected.layout.pages.length).toBe(full.pages.length);

    // The store's builder was never invoked: not for the default variant (the
    // bug), and not for the dated one either (priming supplied it).
    expect(builds).toEqual([]);
  }, 300_000);

  it('builds the other variant only when it is actually selected', async () => {
    const { source, services, store, builds } = spyStore('tracked', 120);
    const dated = await layoutDocumentProgressively(
      source.bodyLayoutInput,
      services,
      datedOptions,
      { hasPaginationFields: source.hasPaginationFields },
    );
    store.prime(datedOptions, dated, true);
    builds.length = 0;

    // Selecting a DIFFERENT variant is what genuinely costs a build — and that
    // only happens when something actually asks for one.
    store.select(defaultOptions);
    expect(builds).toHaveLength(1);
    expect(builds[0]!.currentDateMs).toBe(CURRENT_DATE_MS);
  }, 300_000);

  it('keys an explicit currentDate the same way the render path will', async () => {
    // A viewer with an explicit currentDate must not miss the primed key.
    const { source, services, store, builds } = spyStore('plain', 120);
    const layout = await layoutDocumentProgressively(
      source.bodyLayoutInput,
      services,
      datedOptions,
      { hasPaginationFields: source.hasPaginationFields },
    );
    store.prime(datedOptions, layout, true);
    builds.length = 0;
    store.select(datedOptions);
    expect(builds).toEqual([]);
  }, 300_000);
});
