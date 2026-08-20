import type { ImageFill } from '../types/common.js';
import type { ChartThreeDSurface } from '../types/chart.js';
import { cropSourceMapping, imageNaturalSize } from '../image/crop.js';
import { drawProjected, projectQuadPoint } from '../shape/scene3d-draw.js';
import {
  planChartThreeDSurfacePicture,
  surfacePictureFaceIsEnabled,
  surfacePictureFaceRepetitions,
  surfacePictureFaceUsesValueAxis,
  type ChartThreeDSurfaceKind,
  type SurfacePicturePoint,
  type SurfacePictureQuad,
} from './three-d-surface-picture-plan.js';
import type { ChartThreeDSurfaceGeometry, ThreeDScenePoint } from './three-d.js';
import { MAX_CHART_IMAGE_FILL_TILES } from './resource-limits.js';

function relativeRectQuad(
  quad: SurfacePictureQuad,
  rect: ImageFill['srcRect'] | ImageFill['fillRect'],
): SurfacePictureQuad | null {
  if (!rect || ![rect.l, rect.t, rect.r, rect.b].some(value => (value ?? 0) !== 0)) {
    return quad;
  }
  const left = rect.l ?? 0;
  const top = rect.t ?? 0;
  const right = 1 - (rect.r ?? 0);
  const bottom = 1 - (rect.b ?? 0);
  const points = [
    projectQuadPoint(quad, left, top),
    projectQuadPoint(quad, right, top),
    projectQuadPoint(quad, right, bottom),
    projectQuadPoint(quad, left, bottom),
  ];
  return points.every((point): point is SurfacePicturePoint => point != null)
    ? points as SurfacePictureQuad
    : null;
}

function screenAlignedFace(
  face: readonly ThreeDScenePoint[],
  project: (point: ThreeDScenePoint) => SurfacePicturePoint,
): [ThreeDScenePoint, ThreeDScenePoint, ThreeDScenePoint, ThreeDScenePoint] | null {
  if (face.length !== 4) return null;
  const byY = face.map((scenePoint, index) => ({
    scenePoint,
    projected: project(scenePoint),
    index,
  })).sort((left, right) => left.projected.y - right.projected.y
    || left.projected.x - right.projected.x);
  const top = byY.slice(0, 2).sort((left, right) => left.projected.x - right.projected.x);
  const bottom = byY.slice(2).sort((left, right) => left.projected.x - right.projected.x);
  if (new Set([...top, ...bottom].map(item => item.index)).size !== 4) return null;
  return [top[0].scenePoint, top[1].scenePoint, bottom[1].scenePoint, bottom[0].scenePoint];
}

/** Office plain-stack observation: derive one repetition height from the
 * projected plot-face aspect and source aspect, then share it across the
 * selected floor/wall target. Repetitions start at the target's lower edge.
 * Authored DPI does not affect this chart pictureOptions mode. */
function plainStackFraction(
  referenceAspect: number | null | undefined,
  sourceWidth: number,
  sourceHeight: number,
): number | null {
  if (!(referenceAspect != null && Number.isFinite(referenceAspect) && referenceAspect > 0)
    || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;
  const fraction = referenceAspect * sourceHeight / sourceWidth;
  return Number.isFinite(fraction) && fraction > 0 ? fraction : null;
}

export function paintChartThreeDSurfacePicture(
  ctx: CanvasRenderingContext2D,
  fill: ImageFill,
  image: CanvasImageSource,
  surface: ChartThreeDSurface | null | undefined,
  kind: ChartThreeDSurfaceKind,
  geometry: ChartThreeDSurfaceGeometry,
  visibleFaceIndices: readonly number[],
  project: (point: ThreeDScenePoint) => SurfacePicturePoint,
  valueSpan: number,
): boolean {
  const plan = planChartThreeDSurfacePicture(fill, surface, kind, valueSpan);
  if (!plan || geometry.inner.length !== 4) return false;
  const natural = imageNaturalSize(image);
  if (!(natural.w > 0) || !(natural.h > 0)) return false;
  const crop = cropSourceMapping(image, fill.srcRect);
  const sourceRect = crop
    ? { x0: crop.sx, y0: crop.sy, x1: crop.sx + crop.sw, y1: crop.sy + crop.sh }
    : undefined;
  // Preserve the established planar mapping exactly. Positive-thickness
  // joining faces need their own screen-upright ordering because each face has
  // a different scene-space axis pair.
  const fullQuad: SurfacePictureQuad = [
    project(geometry.inner[3]), project(geometry.inner[2]),
    project(geometry.inner[1]), project(geometry.inner[0]),
  ];
  const interpolate = (
    lower: ThreeDScenePoint,
    upper: ThreeDScenePoint,
    fraction: number,
  ): ThreeDScenePoint => ({
    x: lower.x + (upper.x - lower.x) * fraction,
    y: lower.y + (upper.y - lower.y) * fraction,
    depth: lower.depth + (upper.depth - lower.depth) * fraction,
  });
  const stackQuad = (
    face: readonly ThreeDScenePoint[],
    lower: number,
    upper: number,
  ): SurfacePictureQuad => [
    project(interpolate(face[3], face[0], upper)),
    project(interpolate(face[2], face[1], upper)),
    project(interpolate(face[2], face[1], lower)),
    project(interpolate(face[3], face[0], lower)),
  ];
  const stackFraction = plan.mode === 'stack'
    ? plainStackFraction(geometry.pictureStackAspect, natural.w, natural.h)
    : null;

  if (plan.mode === 'stack') {
    if (stackFraction == null) return false;
    let work = 0;
    let hasFace = false;
    for (const faceIndex of visibleFaceIndices) {
      if (!surfacePictureFaceIsEnabled(plan, faceIndex)) continue;
      const face = geometry.thickness === 0 && faceIndex === 0
        ? [geometry.inner[3], geometry.inner[2], geometry.inner[1], geometry.inner[0]]
        : screenAlignedFace(geometry.faces[faceIndex] ?? [], project);
      if (!face) continue;
      const repetitions = Math.ceil(1 / stackFraction);
      if (!Number.isSafeInteger(repetitions) || repetitions < 1) return false;
      work += repetitions;
      if (work > MAX_CHART_IMAGE_FILL_TILES) return false;
      hasFace = true;
    }
    if (!hasFace) return false;
  }

  ctx.save();
  if (fill.alpha != null) ctx.globalAlpha *= fill.alpha;
  if (plan.mode === 'stretch') {
    for (const faceIndex of visibleFaceIndices) {
      if (!surfacePictureFaceIsEnabled(plan, faceIndex)) continue;
      const aligned = screenAlignedFace(geometry.faces[faceIndex] ?? [], project);
      const quad = geometry.thickness === 0 && faceIndex === 0
        ? fullQuad
        : aligned?.map(project) as SurfacePictureQuad | undefined;
      if (!quad) continue;
      const fillDestination = relativeRectQuad(quad, fill.fillRect);
      if (!fillDestination) continue;
      const destination = crop
        ? relativeRectQuad(fillDestination, {
          l: crop.dxFraction,
          t: crop.dyFraction,
          r: 1 - crop.dxFraction - crop.dwFraction,
          b: 1 - crop.dyFraction - crop.dhFraction,
        })
        : fillDestination;
      if (!destination) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let index = 1; index < quad.length; index++) ctx.lineTo(quad[index].x, quad[index].y);
      ctx.closePath();
      ctx.clip();
      drawProjected(image, ctx, natural.w, natural.h, destination, 0.5, sourceRect);
      ctx.restore();
    }
  } else {
    for (const faceIndex of visibleFaceIndices) {
      if (!surfacePictureFaceIsEnabled(plan, faceIndex)) continue;
      const face = geometry.thickness === 0 && faceIndex === 0
        ? [geometry.inner[3], geometry.inner[2], geometry.inner[1], geometry.inner[0]]
        : screenAlignedFace(geometry.faces[faceIndex] ?? [], project);
      if (!face) continue;
      const quad = face.map(project) as SurfacePictureQuad;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let index = 1; index < quad.length; index++) ctx.lineTo(quad[index].x, quad[index].y);
      ctx.closePath();
      ctx.clip();
      // Repetition follows the value axis across the slab's front and side
      // faces. End faces have no value-axis extent, so Office maps one whole
      // source there instead of compressing every repetition into thickness.
      const repetitions = surfacePictureFaceRepetitions(plan, faceIndex);
      if (plan.mode === 'stack') {
        if (stackFraction == null) continue;
        for (let index = 0; index < Math.ceil(1 / stackFraction); index++) {
          drawProjected(
            image, ctx, natural.w, natural.h,
            stackQuad(face, index * stackFraction, (index + 1) * stackFraction),
            0.5, sourceRect,
          );
        }
      } else if (plan.stackUnit != null && surfacePictureFaceUsesValueAxis(plan, faceIndex)) {
        for (let index = 0; index < repetitions; index++) {
          const lower = index * plan.stackUnit / valueSpan;
          const upper = (index + 1) * plan.stackUnit / valueSpan;
          drawProjected(image, ctx, natural.w, natural.h, stackQuad(face, lower, upper), 0.5, sourceRect);
        }
      } else if (plan.stackUnit != null) {
        drawProjected(image, ctx, natural.w, natural.h, quad, 0.5, sourceRect);
      }
      ctx.restore();
    }
  }
  ctx.restore();
  return true;
}
