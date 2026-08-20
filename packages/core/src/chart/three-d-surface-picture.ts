import type { ImageFill } from '../types/common.js';
import type { ChartThreeDSurface } from '../types/chart.js';
import { imageNaturalSize } from '../image/crop.js';
import { drawProjected } from '../shape/scene3d-draw.js';
import {
  planChartThreeDSurfacePicture,
  type ChartThreeDSurfaceKind,
  type SurfacePicturePoint,
  type SurfacePictureQuad,
} from './three-d-surface-picture-plan.js';
import type { ThreeDScenePoint } from './three-d.js';

export function paintChartThreeDSurfacePicture(
  ctx: CanvasRenderingContext2D,
  fill: ImageFill,
  image: CanvasImageSource,
  surface: ChartThreeDSurface | null | undefined,
  kind: ChartThreeDSurfaceKind,
  inner: readonly ThreeDScenePoint[],
  project: (point: ThreeDScenePoint) => SurfacePicturePoint,
  valueSpan: number,
): boolean {
  const plan = planChartThreeDSurfacePicture(fill, surface, kind, valueSpan);
  if (!plan || inner.length !== 4) return false;
  const natural = imageNaturalSize(image);
  if (!(natural.w > 0) || !(natural.h > 0)) return false;
  const fullQuad: SurfacePictureQuad = [
    project(inner[3]), project(inner[2]), project(inner[1]), project(inner[0]),
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
    project(interpolate(inner[0], inner[3], upper)),
    project(interpolate(inner[1], inner[2], upper)),
    project(interpolate(inner[1], inner[2], lower)),
    project(interpolate(inner[0], inner[3], lower)),
  ];

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(fullQuad[0].x, fullQuad[0].y);
  for (let index = 1; index < fullQuad.length; index++) {
    ctx.lineTo(fullQuad[index].x, fullQuad[index].y);
  }
  ctx.closePath();
  ctx.clip();
  if (fill.alpha != null) ctx.globalAlpha *= fill.alpha;
  if (plan.mode === 'stretch') {
    drawProjected(image, ctx, natural.w, natural.h, fullQuad);
  } else if (kind !== 'floor' && plan.stackUnit != null) {
    for (let index = 0; index < plan.repetitions; index++) {
      const lower = index * plan.stackUnit / valueSpan;
      const upper = (index + 1) * plan.stackUnit / valueSpan;
      drawProjected(image, ctx, natural.w, natural.h, stackQuad(lower, upper));
    }
  }
  ctx.restore();
  return true;
}
