import type { DocxDocumentModel } from '../types.js';
import { layoutSourceStore } from '../layout-source-model-adapter.js';
import { createProductionBodyLayoutRuntime } from '../layout/production-body-layout.js';
import {
  decodeRaster,
  preloadPaintImages,
  type DecodedImage,
  type DocxFetchImage,
} from '../paint/browser-images.js';
import { paintResourceRegistryOf } from '../layout/runtime-state.js';
import type { LayoutServices } from '../layout/types.js';

const EMPTY_DOCUMENT = {
  section: {
    pageWidth: 612,
    pageHeight: 792,
    marginTop: 72,
    marginRight: 72,
    marginBottom: 72,
    marginLeft: 72,
  },
  body: [],
  headers: {},
  footers: {},
} as unknown as DocxDocumentModel;
const source = layoutSourceStore(EMPTY_DOCUMENT);
const bodyInternals = createProductionBodyLayoutRuntime(
  source,
  null,
  {},
).internals;

export const {
  physicalLayoutSection: __test_physicalLayoutSection,
  preRegisterPageFloats: __test_preRegisterPageFloats,
  resolveAnchorBox: __test_resolveAnchorBox,
  resolveColumnWidths,
  resolveShapeBox: __test_resolveShapeBox,
  verticalLayoutSection: __test_verticalLayoutSection,
} = bodyInternals;

export { decodeRaster };
export type { DecodedImage };

export async function preloadImages(
  doc: DocxDocumentModel,
  fetchImage: DocxFetchImage | undefined,
  services?: LayoutServices,
  devicePixelsPerPoint?: number,
): Promise<Map<string, DecodedImage>> {
  const registry = services
    ? paintResourceRegistryOf(services)
    : layoutSourceStore(doc).paintResources;
  return preloadPaintImages(registry.descriptors, fetchImage, undefined, devicePixelsPerPoint);
}
