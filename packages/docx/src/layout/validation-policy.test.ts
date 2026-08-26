import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAndDeepFreezeDocumentLayout,
  deepFreezeDocumentLayout,
} from './invariants.js';
import { LayoutInvariantError } from './diagnostics.js';
import { snapshotPlainData } from './plain-data.js';
import {
  documentLayoutValidationEnabled,
  setDocumentLayoutValidation,
} from './validation-policy.js';
import type { DocumentLayout } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// The retained-layout contract checks (`assertPlainData` + the full invariant
// suite) are development-time guards, not production ones: they inspect
// engine-produced data, so a violation is an engine bug rather than a property
// of the document. This suite pins the policy — what stays on unconditionally
// (freezing), what the switch controls (the recursive traversals), and that the
// default is "on" under a test runner so every other suite keeps validating.
// ─────────────────────────────────────────────────────────────────────────────

/** A layout carrying a non-finite number: rejected by the plain-data traversal
 *  (as INVALID_GEOMETRY) whenever validation is on. */
function layoutWithNonFiniteGeometry(): DocumentLayout {
  return {
    pages: [{ geometry: { widthPt: Number.NaN, heightPt: 792 } }],
    diagnostics: [],
  } as unknown as DocumentLayout;
}

afterEach(() => {
  // Restore the suite-wide default so ordering can never leak policy.
  setDocumentLayoutValidation(true);
});

describe('document layout validation policy', () => {
  it('defaults to enabled under a test runner', () => {
    expect(documentLayoutValidationEnabled()).toBe(true);
  });

  it('reports the configured state', () => {
    setDocumentLayoutValidation(false);
    expect(documentLayoutValidationEnabled()).toBe(false);
    setDocumentLayoutValidation(true);
    expect(documentLayoutValidationEnabled()).toBe(true);
  });

  it('rejects an invalid retained layout while enabled', () => {
    setDocumentLayoutValidation(true);
    expect(() => assertAndDeepFreezeDocumentLayout(layoutWithNonFiniteGeometry()))
      .toThrow(LayoutInvariantError);
  });

  it('skips the invariant traversal while disabled', () => {
    setDocumentLayoutValidation(false);
    expect(() => assertAndDeepFreezeDocumentLayout(layoutWithNonFiniteGeometry())).not.toThrow();
  });

  it('freezes the layout whether or not validation runs', () => {
    setDocumentLayoutValidation(false);
    const layout = {
      pages: [{ geometry: { widthPt: 612, heightPt: 792 } }],
      diagnostics: [],
    } as unknown as DocumentLayout;
    const frozen = assertAndDeepFreezeDocumentLayout(layout);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.pages)).toBe(true);
    expect(Object.isFrozen(frozen.pages[0])).toBe(true);
    expect(Object.isFrozen(frozen.pages[0].geometry)).toBe(true);
  });

  it('still freezes via deepFreezeDocumentLayout while disabled', () => {
    setDocumentLayoutValidation(false);
    const layout = {
      pages: [{ geometry: { widthPt: 612, heightPt: 792 } }],
      diagnostics: [],
    } as unknown as DocumentLayout;
    const frozen = deepFreezeDocumentLayout(layout);
    expect(Object.isFrozen(frozen.pages[0].geometry)).toBe(true);
  });

  it('validates a layout that was frozen while validation was disabled', () => {
    // A layout only joins the "verified" identity set when it was actually
    // checked, so turning validation back on must not skip it as already-done.
    setDocumentLayoutValidation(false);
    const layout = layoutWithNonFiniteGeometry();
    assertAndDeepFreezeDocumentLayout(layout);
    setDocumentLayoutValidation(true);
    expect(() => assertAndDeepFreezeDocumentLayout(layout)).toThrow(LayoutInvariantError);
  });

  it('keeps snapshotPlainData sealing and cloning while disabled', () => {
    setDocumentLayoutValidation(false);
    const source = { a: 1, nested: { b: [2, 3] } };
    const snapshot = snapshotPlainData(source, 'test');
    expect(snapshot).toEqual(source);
    expect(snapshot).not.toBe(source);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.nested.b)).toBe(true);
  });

  it('still reports genuinely non-cloneable data while disabled', () => {
    // The structured clone remains the backstop: only the precise property path
    // in the message is development-only.
    setDocumentLayoutValidation(false);
    expect(() => snapshotPlainData({ fn: () => 1 }, 'test')).toThrow(TypeError);
  });
});
