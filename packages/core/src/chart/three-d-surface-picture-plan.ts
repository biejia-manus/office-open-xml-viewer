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
  slabFaces?: {
    front: boolean;
    sides: boolean;
    end: boolean;
  };
}

/** CT_Surface slab faces are emitted as inner, outer, then the four joining
 * faces. ECMA-376 §21.2.2.1-.3 names the visible picture targets front, sides,
 * and end. The observed 25% wall/floor boundary maps the inner face to front,
 * alternating joining faces to end/sides, and leaves the hidden outer face
 * unpainted. */
export function surfacePictureFaceIsEnabled(
  plan: SurfacePicturePlan,
  faceIndex: number,
): boolean {
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) return false;
  if (!plan.slabFaces) return faceIndex === 0;
  if (faceIndex === 0) return plan.slabFaces.front;
  if (faceIndex === 1 || faceIndex >= 6) return false;
  return faceIndex % 2 === 0 ? plan.slabFaces.end : plan.slabFaces.sides;
}

function rectIsIdentity(rect: ImageFill['srcRect'] | ImageFill['fillRect']): boolean {
  return rect == null || [rect.l, rect.t, rect.r, rect.b].every(value => (value ?? 0) === 0);
}

/** The Office-observed, bounded subset of CT_Surface pictureOptions.
 *
 * ECMA-376 defines the flags and formats but not wall texture projection.
 * Excel/PDF observations establish full-face stretch and value-axis
 * stackScale on planar back/side walls; floor ignores pictureStackUnit. The
 * positive-thickness boundary is limited to stretch, whose front/sides/end
 * targets are independently authored and map to the bounded six-face slab. */
export function planChartThreeDSurfacePicture(
  fill: ImageFill,
  surface: ChartThreeDSurface | null | undefined,
  kind: ChartThreeDSurfaceKind,
  valueSpan?: number,
): SurfacePicturePlan | null {
  if (fill.tile || fill.stretch !== true
    || !rectIsIdentity(fill.srcRect) || !rectIsIdentity(fill.fillRect)
    || fill.rotWithShape === false
    || (fill.alpha != null && (!Number.isFinite(fill.alpha) || fill.alpha < 0 || fill.alpha > 1))) {
    return null;
  }
  const options = surface?.pictureOptions;
  if (options?.pictureFormatAuthored === true && options.pictureFormat == null) return null;
  if (options?.pictureStackUnitAuthored === true && options.pictureStackUnit == null) return null;
  const format = options?.pictureFormat ?? 'stretch';
  const thickness = surface?.thicknessPercent ?? 0;
  if (thickness !== 0) {
    if (!Number.isFinite(thickness) || thickness < 0 || format !== 'stretch'
      || options?.pictureStackUnitAuthored === true || options?.pictureStackUnit != null) {
      return null;
    }
    const slabFaces = {
      front: options?.applyToFront !== false,
      sides: options?.applyToSides !== false,
      end: options?.applyToEnd !== false,
    };
    return Object.values(slabFaces).some(Boolean)
      ? { mode: 'stretch', repetitions: 1, slabFaces }
      : null;
  }
  if (kind === 'backWall' && options?.applyToFront === false) return null;
  if ((kind === 'floor' || kind === 'sideWall') && options?.applyToSides === false) return null;
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
