import type { DocxDocument } from './document.js';
import { documentLayoutRuntimeOf } from './layout/runtime-state.js';

/** Internal bridge used when a Viewer borrows an already-loaded document.
 *
 * The selected view belongs to DocxDocument's retained-layout runtime. Keeping
 * this accessor outside the public class surface lets both Viewer factories
 * inherit that authority without exposing layout bookkeeping as public API.
 */
export function activeDocxLayoutViewOf(document: DocxDocument): Readonly<{
  showTrackedChanges: boolean;
  currentDate: number;
}> {
  const runtime = documentLayoutRuntimeOf(document);
  const active = runtime.activeLayoutOptions;
  return {
    showTrackedChanges: active?.showTrackedChanges === true,
    currentDate: active?.currentDateMs ?? runtime.defaultCurrentDateMs,
  };
}
