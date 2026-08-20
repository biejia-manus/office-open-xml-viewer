import type { ImageFill } from '../types/common.js';
import type { ChartThreeDSurface } from '../types/chart.js';
import { MAX_CHART_IMAGE_FILL_TILES } from './resource-limits.js';

export type ChartThreeDSurfaceKind = 'floor' | 'sideWall' | 'backWall';
export interface SurfacePicturePoint { x: number; y: number }
export type SurfacePictureQuad = [
  SurfacePicturePoint,
  SurfacePicturePoint,
  SurfacePicturePoint,
  SurfacePicturePoint,
];

export interface SurfacePicturePlan {
  mode: 'stretch' | 'stackScale';
  repetitions: number;
  stackUnit?: number;
}

function rectIsIdentity(rect: ImageFill['srcRect'] | ImageFill['fillRect']): boolean {
  return rect == null || [rect.l, rect.t, rect.r, rect.b].every(value => (value ?? 0) === 0);
}

/** The Office-observed, bounded subset of CT_Surface pictureOptions.
 *
 * ECMA-376 defines the flags and formats but not wall texture projection.
 * Excel/PDF observations establish full-face stretch and value-axis
 * stackScale on planar back/side walls; floor ignores pictureStackUnit. A
 * positive-thickness slab needs an unobserved front/side/end face mapping, so
 * it deliberately remains transparent instead of guessing. */
export function planChartThreeDSurfacePicture(
  fill: ImageFill,
  surface: ChartThreeDSurface | null | undefined,
  kind: ChartThreeDSurfaceKind,
  valueSpan?: number,
): SurfacePicturePlan | null {
  if ((surface?.thicknessPercent ?? 0) !== 0) return null;
  if (fill.tile || fill.stretch !== true
    || !rectIsIdentity(fill.srcRect) || !rectIsIdentity(fill.fillRect)
    || fill.rotWithShape === false
    || (fill.alpha != null && (!Number.isFinite(fill.alpha) || fill.alpha < 0 || fill.alpha > 1))) {
    return null;
  }
  const options = surface?.pictureOptions;
  if (kind === 'backWall' && options?.applyToFront === false) return null;
  if ((kind === 'floor' || kind === 'sideWall') && options?.applyToSides === false) return null;
  if (options?.pictureFormatAuthored === true && options.pictureFormat == null) return null;
  if (options?.pictureStackUnitAuthored === true && options.pictureStackUnit == null) return null;
  const format = options?.pictureFormat ?? 'stretch';
  if ((options?.pictureStackUnitAuthored === true || options?.pictureStackUnit != null)
    && format !== 'stackScale') return null;
  if (format === 'stretch') return { mode: 'stretch', repetitions: 1 };
  if (format !== 'stackScale') return null;
  const stackUnit = options?.pictureStackUnit;
  if (!(stackUnit != null && Number.isFinite(stackUnit) && stackUnit > 0)) return null;
  // MS-OE376 §2.1.1543(c): Excel ignores pictureStackUnit on floor.
  if (kind === 'floor') return { mode: 'stretch', repetitions: 1 };
  if (valueSpan == null) return { mode: 'stackScale', repetitions: 1, stackUnit };
  if (!(Number.isFinite(valueSpan) && valueSpan > 0)) return null;
  const repetitions = Math.ceil(valueSpan / stackUnit);
  if (!Number.isSafeInteger(repetitions)
    || repetitions < 1 || repetitions > MAX_CHART_IMAGE_FILL_TILES) return null;
  return { mode: 'stackScale', repetitions, stackUnit };
}
