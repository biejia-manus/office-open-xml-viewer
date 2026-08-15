import type { ChartModel, ChartRect } from '../types/chart.js';
import type { WorkerLoadableAddon } from '../worker/addon.js';

/** Synchronous optional ChartEx Region Map painter. The Natural Earth geometry
 * and projection implementation live in `@silurus/ooxml/region-map`, keeping
 * ordinary format bundles free of the fixed geographic asset. */
export interface ChartRegionMapRenderer extends WorkerLoadableAddon {
  render(
    ctx: CanvasRenderingContext2D,
    chart: ChartModel,
    rect: ChartRect,
    ptToPx: number,
  ): boolean;
}
