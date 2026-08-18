/** Which format owns the omitted category-axis gap policy. */
export type CategoryGapPolicy = 'legacy' | 'chartex';

/** Position a category-like data point inside its authored axis interval. */
export function categoryPositionFraction(
  index: number,
  count: number,
  between: boolean,
  reversed = false,
): number {
  const last = Math.max(0, count - 1);
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.min(last, index)) : 0;
  const fraction = between
    ? (safeIndex + 0.5) / Math.max(1, count)
    : count === 1 ? 0.5 : safeIndex / last;
  return reversed ? 1 - fraction : fraction;
}

/**
 * Resolve the gap between category bodies as a percentage of one body.
 *
 * Classic `<c:barChart>` keeps the ECMA-376 default of 150%. ChartEx
 * `<cx:catScaling gapWidth>` has no schema default, so the supported ordinal
 * layouts share a small deterministic 33% fallback. An authored value has
 * already been normalized by the parser and is always authoritative.
 */
export function resolveCategoryGapWidthPercent(
  authoredPercent: number | null | undefined,
  policy: CategoryGapPolicy,
): number {
  if (authoredPercent != null && Number.isFinite(authoredPercent)) {
    return Math.max(0, Math.min(500, authoredPercent));
  }
  return policy === 'legacy' ? 150 : 33;
}
