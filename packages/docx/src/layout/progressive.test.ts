import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLayoutServices } from '../layout-runtime.js';
import { layoutSourceStore } from '../layout-source-model-adapter.js';
import {
  installStubCanvas,
  syntheticDocxModel,
  type SyntheticDocumentShape,
} from '../testing/synthetic-document.js';
import { paginateBody } from './body-paginator.js';
import { layoutFingerprint } from './invariants.js';
import { normalizeLayoutOptions } from './options.js';
import { PaginationAbortError } from './pagination-scheduler.js';
import {
  layoutDocumentProgressively,
  type ProgressiveLayoutPreview,
} from './progressive.js';
import { setDocumentLayoutValidation } from './validation-policy.js';
import type { DocumentLayout, LayoutPage } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Progressive layout makes two promises, and this suite is about pinning both.
//
// 1. The layout it finally returns is the ordinary full layout — byte-identical
//    to a blocking load. Previewing must never leak into the real result.
// 2. The pages it publishes early are the SAME pages the real layout will show,
//    for documents without PAGE/NUMPAGES feedback. That is the claim that
//    justifies painting them at all: without it, the viewer would flash content
//    that then moves.
//
// The second is the interesting one. It rests on dropping the preview's last
// page — the only page truncating the body can disturb — so the test compares
// every published preview page against the real layout page by page.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_DATE_MS = 1_700_000_000_000;

function open(shape: SyntheticDocumentShape, paragraphs: number) {
  const source = layoutSourceStore(syntheticDocxModel(shape, { paragraphs }));
  return {
    source,
    services: createLayoutServices(source),
    options: normalizeLayoutOptions(undefined, CURRENT_DATE_MS),
  };
}

/** Compare one page's geometry and painted content, ignoring nothing. */
function pageFingerprint(page: LayoutPage): string {
  return layoutFingerprint({ pages: [page], diagnostics: [] } as DocumentLayout);
}

beforeAll(() => {
  installStubCanvas();
});

afterAll(() => {
  setDocumentLayoutValidation(true);
});

describe('progressive layout returns the authoritative layout', () => {
  const SHAPES: readonly (readonly [SyntheticDocumentShape, number])[] = [
    ['plain', 120],
    ['header-footer', 120],
    ['fields', 120],
  ];

  for (const [shape, paragraphs] of SHAPES) {
    it(`${shape} matches a blocking layout exactly`, async () => {
      const blockingCase = open(shape, paragraphs);
      const blocking = paginateBody(
        blockingCase.source.bodyLayoutInput,
        blockingCase.services,
        blockingCase.options,
      );

      const progressiveCase = open(shape, paragraphs);
      const progressive = await layoutDocumentProgressively(
        progressiveCase.source.bodyLayoutInput,
        progressiveCase.services,
        progressiveCase.options,
        { hasPaginationFields: progressiveCase.source.hasPaginationFields },
      );

      expect(progressive.pages.length).toBe(blocking.pages.length);
      expect(layoutFingerprint(progressive)).toBe(layoutFingerprint(blocking));
    }, 300_000);
  }
});

describe('preview pages match the final layout', () => {
  it('publishes opening pages identical to the real ones (plain)', async () => {
    // Long enough that intermediate chain steps are worth doing: a short
    // document deliberately skips them, since the finished layout is imminent.
    const previews: ProgressiveLayoutPreview[] = [];
    const testCase = open('plain', 600);
    const final = await layoutDocumentProgressively(
      testCase.source.bodyLayoutInput,
      testCase.services,
      testCase.options,
      {
        hasPaginationFields: testCase.source.hasPaginationFields,
        onPreview: (preview) => { previews.push(preview); },
      },
    );

    // The chain publishes repeatedly, each step covering more of the document.
    expect(previews.length).toBeGreaterThan(1);
    const counts = previews.map((preview) => preview.layout.pages.length);
    expect(counts).toEqual([...counts].sort((left, right) => left - right));
    expect(new Set(counts).size).toBe(counts.length);
    // Every publication is a genuine head start, not the whole document.
    expect(counts.at(-1)!).toBeLessThan(final.pages.length);

    // Every page of every publication must equal the page the finished layout
    // puts at that index — otherwise content would visibly move as it arrives.
    for (const preview of previews) {
      expect(preview.exact).toBe(true);
      preview.layout.pages.forEach((page, index) => {
        expect(pageFingerprint(page as LayoutPage))
          .toBe(pageFingerprint(final.pages[index] as LayoutPage));
      });
    }
  }, 300_000);

  it('publishes opening pages identical to the real ones (header-footer)', async () => {
    // Header/footer reserve convergence runs for this shape, so it checks that
    // a preview carrying the same stories reserves the same band.
    const previews: ProgressiveLayoutPreview[] = [];
    const testCase = open('header-footer', 200);
    const final = await layoutDocumentProgressively(
      testCase.source.bodyLayoutInput,
      testCase.services,
      testCase.options,
      {
        hasPaginationFields: testCase.source.hasPaginationFields,
        onPreview: (preview) => { previews.push(preview); },
      },
    );

    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.exact).toBe(true);
      preview.layout.pages.forEach((page, index) => {
        expect(pageFingerprint(page as LayoutPage))
          .toBe(pageFingerprint(final.pages[index] as LayoutPage));
      });
    }
  }, 300_000);

  it('marks a PAGE/NUMPAGES document inexact', async () => {
    const previews: ProgressiveLayoutPreview[] = [];
    const testCase = open('fields', 200);
    expect(testCase.source.hasPaginationFields).toBe(true);
    await layoutDocumentProgressively(
      testCase.source.bodyLayoutInput,
      testCase.services,
      testCase.options,
      {
        hasPaginationFields: testCase.source.hasPaginationFields,
        onPreview: (preview) => { previews.push(preview); },
      },
    );
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) expect(preview.exact).toBe(false);
  }, 300_000);

  it('stops the chain when the drain is aborted', async () => {
    // Destroying the viewer mid-load must stop the work, not merely ignore it:
    // the remaining pagination would otherwise keep consuming main-thread
    // slices for a document nobody can see.
    const previews: ProgressiveLayoutPreview[] = [];
    const controller = new AbortController();
    const testCase = open('plain', 400);
    await expect(layoutDocumentProgressively(
      testCase.source.bodyLayoutInput,
      testCase.services,
      testCase.options,
      {
        hasPaginationFields: testCase.source.hasPaginationFields,
        onPreview: (preview) => { previews.push(preview); },
        scheduler: {
          now: () => Number.MAX_SAFE_INTEGER,
          sliceMs: 0,
          // Abort at the first opportunity the chain releases the thread.
          yieldToHost: () => { controller.abort(); return Promise.resolve(); },
          signal: controller.signal,
        },
      },
    )).rejects.toBeInstanceOf(PaginationAbortError);
    // The synchronous opening preview had already been published; nothing
    // further may be.
    expect(previews.length).toBeLessThanOrEqual(1);
  }, 300_000);

  it('matches a blocking layout for a non-default date variant', async () => {
    // A variant keyed off an explicit currentDate must converge to exactly the
    // blocking result for that same key, not to the default one.
    const datedOptions = normalizeLayoutOptions(
      new Date(CURRENT_DATE_MS + 86_400_000),
      CURRENT_DATE_MS,
    );
    const blockingCase = open('tracked', 120);
    const blocking = paginateBody(
      blockingCase.source.bodyLayoutInput,
      blockingCase.services,
      datedOptions,
    );
    const progressiveCase = open('tracked', 120);
    const progressive = await layoutDocumentProgressively(
      progressiveCase.source.bodyLayoutInput,
      progressiveCase.services,
      datedOptions,
      { hasPaginationFields: progressiveCase.source.hasPaginationFields },
    );
    expect(layoutFingerprint(progressive)).toBe(layoutFingerprint(blocking));
  }, 300_000);

  it('skips previewing a document short enough not to need it', async () => {
    const previews: ProgressiveLayoutPreview[] = [];
    const testCase = open('plain', 4);
    await layoutDocumentProgressively(
      testCase.source.bodyLayoutInput,
      testCase.services,
      testCase.options,
      {
        hasPaginationFields: testCase.source.hasPaginationFields,
        onPreview: (preview) => { previews.push(preview); },
      },
    );
    expect(previews).toEqual([]);
  }, 300_000);
});
