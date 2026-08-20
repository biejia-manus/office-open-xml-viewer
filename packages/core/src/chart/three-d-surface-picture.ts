import type { ImageFill } from '../types/common.js';
import type { ChartThreeDSurface } from '../types/chart.js';
import { cropSourceRect, imageNaturalSize } from '../image/crop.js';
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

function fillRectQuad(
  quad: SurfacePictureQuad,
  fillRect: ImageFill['fillRect'],
): SurfacePictureQuad | null {
  if (!fillRect || ![fillRect.l, fillRect.t, fillRect.r, fillRect.b].some(value => (value ?? 0) !== 0)) {
    return quad;
  }
  const left = fillRect.l ?? 0;
  const top = fillRect.t ?? 0;
  const right = 1 - (fillRect.r ?? 0);
  const bottom = 1 - (fillRect.b ?? 0);
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
  const crop = cropSourceRect(image, fill.srcRect);
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
      const destination = fillRectQuad(quad, fill.fillRect);
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
  } else if (plan.stackUnit != null) {
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
      if (surfacePictureFaceUsesValueAxis(plan, faceIndex)) {
        for (let index = 0; index < repetitions; index++) {
          const lower = index * plan.stackUnit / valueSpan;
          const upper = (index + 1) * plan.stackUnit / valueSpan;
          drawProjected(image, ctx, natural.w, natural.h, stackQuad(face, lower, upper), 0.5, sourceRect);
        }
      } else {
        drawProjected(image, ctx, natural.w, natural.h, quad, 0.5, sourceRect);
      }
      ctx.restore();
    }
  }
  ctx.restore();
  return true;
}
