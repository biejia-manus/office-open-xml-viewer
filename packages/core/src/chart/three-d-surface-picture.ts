import type { ImageFill } from '../types/common.js';
import type { ChartThreeDSurface } from '../types/chart.js';
import { imageNaturalSize } from '../image/crop.js';
import { drawProjected } from '../shape/scene3d-draw.js';
import {
  planChartThreeDSurfacePicture,
  surfacePictureFaceIsEnabled,
  type ChartThreeDSurfaceKind,
  type SurfacePicturePoint,
  type SurfacePictureQuad,
} from './three-d-surface-picture-plan.js';
import type { ChartThreeDSurfaceGeometry, ThreeDScenePoint } from './three-d.js';

function screenAlignedQuad(
  face: readonly ThreeDScenePoint[],
  project: (point: ThreeDScenePoint) => SurfacePicturePoint,
): SurfacePictureQuad | null {
  if (face.length !== 4) return null;
  const points = face.map(project);
  const byY = points.map((point, index) => ({ point, index }))
    .sort((left, right) => left.point.y - right.point.y || left.point.x - right.point.x);
  const top = byY.slice(0, 2).sort((left, right) => left.point.x - right.point.x);
  const bottom = byY.slice(2).sort((left, right) => left.point.x - right.point.x);
  if (new Set([...top, ...bottom].map(item => item.index)).size !== 4) return null;
  return [top[0].point, top[1].point, bottom[1].point, bottom[0].point];
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
  const stackQuad = (lower: number, upper: number): SurfacePictureQuad => [
    project(interpolate(geometry.inner[0], geometry.inner[3], upper)),
    project(interpolate(geometry.inner[1], geometry.inner[2], upper)),
    project(interpolate(geometry.inner[1], geometry.inner[2], lower)),
    project(interpolate(geometry.inner[0], geometry.inner[3], lower)),
  ];

  ctx.save();
  if (fill.alpha != null) ctx.globalAlpha *= fill.alpha;
  if (plan.mode === 'stretch') {
    for (const faceIndex of visibleFaceIndices) {
      if (!surfacePictureFaceIsEnabled(plan, faceIndex)) continue;
      const quad = geometry.thickness === 0 && faceIndex === 0
        ? fullQuad
        : screenAlignedQuad(geometry.faces[faceIndex] ?? [], project);
      if (!quad) continue;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(quad[0].x, quad[0].y);
      for (let index = 1; index < quad.length; index++) ctx.lineTo(quad[index].x, quad[index].y);
      ctx.closePath();
      ctx.clip();
      drawProjected(image, ctx, natural.w, natural.h, quad);
      ctx.restore();
    }
  } else if (kind !== 'floor' && plan.stackUnit != null) {
    ctx.beginPath();
    ctx.moveTo(fullQuad[0].x, fullQuad[0].y);
    for (let index = 1; index < fullQuad.length; index++) ctx.lineTo(fullQuad[index].x, fullQuad[index].y);
    ctx.closePath();
    ctx.clip();
    for (let index = 0; index < plan.repetitions; index++) {
      const lower = index * plan.stackUnit / valueSpan;
      const upper = (index + 1) * plan.stackUnit / valueSpan;
      drawProjected(image, ctx, natural.w, natural.h, stackQuad(lower, upper));
    }
  }
  ctx.restore();
  return true;
}
