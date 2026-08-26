import { writeFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createLayoutServices } from '../layout-runtime.js';
import { layoutSourceStore } from '../layout-source-model-adapter.js';
import {
  installStubCanvas,
  syntheticDocxModel,
  type SyntheticDocumentShape,
} from '../testing/synthetic-document.js';
import { paginateBody } from './body-paginator.js';
import { layoutOptionsForRender } from './options.js';
import { layoutDocumentProgressively } from './progressive.js';
import { setDocumentLayoutValidation } from './validation-policy.js';

/**
 * Progressive-layout latency harness. Run with `pnpm bench:progressive`; it is
 * skipped in an ordinary `pnpm test` because a full matrix takes minutes.
 *
 * ## What it measures
 *
 * Per document shape: how long until a paintable prefix exists, how long until
 * the authoritative layout exists, and what one straight-through blocking pass
 * costs. From those, the two ratios that actually matter — the time-to-first-
 * page win, and the price the growing-prefix chain pays for it.
 *
 * The last two columns split what would otherwise be one indistinguishable
 * overhead number. `repeated work` is the growing-prefix chain measured with
 * yielding disabled, which is the quantity `progressive.ts` claims a ratio-4
 * geometric series keeps below a third of one layout — so this checks that
 * claim rather than trusting it. `slicing` is what spreading the same work over
 * event-loop turns adds on top; it buys responsiveness, and in worker mode it
 * is also what keeps the worker able to answer render requests mid-pagination.
 *
 * ## What it does NOT measure — read before quoting any number
 *
 * These are LAYOUT-COST numbers, taken in-process against a stub canvas. They
 * exclude, entirely:
 *
 *   - worker spin-up, the render-worker module fetch/eval and the init handshake
 *   - WASM instantiation, ZIP/XML parse and model materialization
 *   - font preload (Google, embedded, local metrics) — all of which precede
 *     pagination and all of which are on the real first-paint critical path
 *   - math conversion and rasterization
 *   - the wire: structured clone per publication, and ImageBitmap transfer
 *   - painting: `renderLayoutSourceToCanvas` is never called
 *   - main-thread frame contention, which is the entire point of worker mode
 *     and the one thing an in-process harness structurally cannot show
 *
 * The stub canvas also substitutes arithmetic glyph widths for real shaping.
 * Since measurement dominates the block loop, the absolute milliseconds are
 * optimistic and the progressive:blocking RATIO is the portable finding. For an
 * end-to-end number including everything above, read the Storybook
 * "progressive first paint" story's `First paint … → full layout …` line.
 */

const ENABLED = !!process.env.OOXML_DOCX_PROGRESSIVE_BENCH;

const CASES: readonly (readonly [SyntheticDocumentShape, number])[] = [
  ['plain', 400],
  ['header-footer', 200],
  ['fields', 200],
  ['tables', 60],
  ['tracked-fields', 200],
];

interface Row {
  shape: string;
  paragraphs: number;
  firstPreviewMs: number | null;
  previewPages: number;
  progressiveMs: number;
  unslicedMs: number;
  blockingMs: number;
  pages: number;
  measureCalls: number;
}

function fixture(shape: SyntheticDocumentShape, paragraphs: number) {
  // Rebuilt per timing so neither run inherits the other's warmed caches; the
  // model itself is LCG-derived and therefore identical every time.
  const source = layoutSourceStore(syntheticDocxModel(shape, { paragraphs }));
  return { source, services: createLayoutServices(source) };
}

function fixed(value: number, places = 1): string {
  return value.toFixed(places);
}

describe.skipIf(!ENABLED)('progressive layout latency', () => {
  let measureTextCalls: () => number;

  beforeAll(() => {
    ({ measureTextCalls } = installStubCanvas());
    // `validation-policy.ts` turns path-precise retained-layout validation ON
    // whenever VITEST is set. Leaving it on would measure what CI pays, not
    // what a shipped viewer pays.
    setDocumentLayoutValidation(false);
  });

  it('reports time-to-first-page against a blocking layout', async () => {
    const options = layoutOptionsForRender({ defaultCurrentDateMs: 1_700_000_000_000 });
    const rows: Row[] = [];

    for (const [shape, paragraphs] of CASES) {
      // 1. Progressive: timestamp the first publication, then run to completion.
      const progressive = fixture(shape, paragraphs);
      const callsBefore = measureTextCalls();
      const started = performance.now();
      let firstPreviewMs: number | null = null;
      let previewPages = 0;
      const full = await layoutDocumentProgressively(
        progressive.source.bodyLayoutInput,
        progressive.services,
        options,
        {
          hasPaginationFields: progressive.source.hasPaginationFields,
          onPreview: (preview) => {
            firstPreviewMs ??= performance.now() - started;
            if (previewPages === 0) previewPages = preview.layout.pages.length;
          },
        },
      );
      const progressiveMs = performance.now() - started;
      const measureCalls = measureTextCalls() - callsBefore;

      // 2. Progressive again, but never yielding. Separates the chain's
      //    repeated-prefix work from the cost of spreading it over event-loop
      //    turns — without this the two are indistinguishable, and the
      //    repeated-work claim in progressive.ts cannot be checked.
      const unslicedFixture = fixture(shape, paragraphs);
      const unslicedStart = performance.now();
      await layoutDocumentProgressively(
        unslicedFixture.source.bodyLayoutInput,
        unslicedFixture.services,
        options,
        {
          hasPaginationFields: unslicedFixture.source.hasPaginationFields,
          scheduler: { sliceMs: Number.POSITIVE_INFINITY },
          onPreview: () => {},
        },
      );
      const unslicedMs = performance.now() - unslicedStart;

      // 3. Baseline: one straight-through pass, on a cold fixture.
      const blockingFixture = fixture(shape, paragraphs);
      const blockingStart = performance.now();
      const blocking = paginateBody(
        blockingFixture.source.bodyLayoutInput,
        blockingFixture.services,
        options,
      );
      const blockingMs = performance.now() - blockingStart;

      // The guarantee the whole feature rests on: progressive changes WHEN
      // pages appear, never WHICH pages appear.
      expect(full.pages.length).toBe(blocking.pages.length);

      rows.push({
        shape,
        paragraphs,
        firstPreviewMs,
        previewPages,
        progressiveMs,
        unslicedMs,
        blockingMs,
        pages: full.pages.length,
        measureCalls,
      });
    }

    const lines = [
      '',
      '| shape | body | pages | first preview | progressive total | unsliced | blocking | speedup to 1st page | repeated work | slicing |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...rows.map((row) => {
        const first = row.firstPreviewMs === null ? 'none' : `${fixed(row.firstPreviewMs)}ms`;
        const speedup = row.firstPreviewMs === null
          ? '—'
          : `${fixed(row.blockingMs / row.firstPreviewMs, 2)}×`;
        return `| ${row.shape} | ${row.paragraphs} | ${row.pages} | ${first} | `
          + `${fixed(row.progressiveMs)}ms | ${fixed(row.unslicedMs)}ms | `
          + `${fixed(row.blockingMs)}ms | ${speedup} | `
          + `${fixed(row.unslicedMs / row.blockingMs, 2)}× | `
          + `${fixed(row.progressiveMs / row.unslicedMs, 2)}× |`;
      }),
      '',
      'Layout cost only — excludes worker spin-up, WASM parse, font preload,',
      'wire transfer and paint. See this file’s header before quoting these.',
      '',
    ];
    const report = lines.join('\n');
    // Written as well as printed: vitest intercepts console output, and the
    // table is the point of the run.
    process.stdout.write(`${report}\n`);
    const out = process.env.OOXML_DOCX_PROGRESSIVE_BENCH_OUTPUT;
    if (out) writeFileSync(out, `${report}\n`);

    expect(rows).toHaveLength(CASES.length);
  }, 1_800_000);
});
