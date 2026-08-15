import type { LoadedWorkerRenderAddons } from '@silurus/ooxml-core/worker';
import type { ParsedWorkbook, Worksheet } from './types.js';
import type { RenderDeps } from './render-orchestrator.js';

/** Rebuild the renderer dependency object inside the worker realm. Addons are
 * dependencies, not per-frame options: the orchestrator intentionally reads
 * them from this object when it creates the immutable render projection. */
export function workerRenderDeps(
  ws: Worksheet,
  styles: ParsedWorkbook['styles'],
  addons: LoadedWorkerRenderAddons,
): RenderDeps {
  return {
    ws,
    styles,
    math: addons.math,
    threeD: addons.threeD,
    regionMap: addons.regionMap,
  };
}
