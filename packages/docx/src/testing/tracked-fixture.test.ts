import { beforeAll, describe, expect, it } from 'vitest';
import { createLayoutServices } from '../layout-runtime.js';
import { layoutSourceStore } from '../layout-source-model-adapter.js';
import { paginateBody } from '../layout/body-paginator.js';
import { layoutFingerprint } from '../layout/invariants.js';
import { normalizeLayoutOptions } from '../layout/options.js';
import { installStubCanvas, syntheticDocxModel } from './synthetic-document.js';
import type { DocumentLayout } from '../layout/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// The `tracked` fixtures carry deleted (`w:del`) runs, which the final-content
// projection drops before layout. Their usefulness is itself worth pinning: if
// deletions ever stopped being projected away, every test built on the fixture
// would keep passing while testing something else.
// ─────────────────────────────────────────────────────────────────────────────

const CURRENT_DATE_MS = 1_700_000_000_000;

function layoutOf(shape: 'plain' | 'tracked' | 'tracked-fields'): DocumentLayout {
  const source = layoutSourceStore(syntheticDocxModel(shape, { paragraphs: 120 }));
  return paginateBody(
    source.bodyLayoutInput,
    createLayoutServices(source),
    normalizeLayoutOptions(undefined, CURRENT_DATE_MS),
  );
}

beforeAll(() => {
  installStubCanvas();
});

describe('tracked-changes fixture', () => {
  it('lays out less content than the same document without deletions', () => {
    // Half of every other paragraph sits in a deleted run, so projecting the
    // final content away must cost pages against the undeleted `plain` shape.
    expect(layoutOf('tracked').pages.length).toBeLessThan(layoutOf('plain').pages.length);
  }, 300_000);

  it('is deterministic', () => {
    expect(layoutFingerprint(layoutOf('tracked')))
      .toBe(layoutFingerprint(layoutOf('tracked')));
  }, 300_000);

  it('reports pagination fields only for the tracked-fields shape', () => {
    expect(layoutSourceStore(syntheticDocxModel('tracked', { paragraphs: 8 }))
      .hasPaginationFields).toBe(false);
    expect(layoutSourceStore(syntheticDocxModel('tracked-fields', { paragraphs: 8 }))
      .hasPaginationFields).toBe(true);
  });
});
