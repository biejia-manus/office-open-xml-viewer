// Opt-in offline ChartEx Region Map renderer entry point.

import {
  renderRegionMapChart,
} from '../packages/core/src/chart/region-map-renderer.js';
import type { ChartRegionMapRenderer } from '../packages/core/src/chart/region-map-contract.js';
import { createBuiltinWorkerRendererDescriptor } from '../packages/core/src/worker/renderer-module-contract.js';

export const regionMap: ChartRegionMapRenderer = {
  render: renderRegionMapChart,
  worker: createBuiltinWorkerRendererDescriptor('regionMap'),
};

export type { ChartRegionMapRenderer } from '../packages/core/src/chart/region-map-contract.js';
