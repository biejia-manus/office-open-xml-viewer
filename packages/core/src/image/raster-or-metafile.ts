// Shared admission and decode boundary for DrawingML raster/metafile blips.
// Format players remain in their format-specific modules; this module owns the
// cross-format safety policy, decoder-side resizing, and final surface check.

import { renderEmfToBitmap } from './emf.js';
import { closeImageBitmapIfSupported } from './image-bitmap-lifecycle.js';
import {
  MAX_RASTER_DIMENSION,
  MAX_RASTER_PIXELS,
  MAX_RASTER_SOURCE_DIMENSION,
  MAX_RASTER_SOURCE_PIXELS,
  OoxmlDecodedImageLimitError,
} from './pixel-budget.js';
import { inspectRasterBlob, type RasterBlobInspection } from './raster-blob-inspection.js';
import {
  sourceRasterExceedsBudget,
  type RasterDimensions,
} from './raster-dimensions.js';
import { isTiff, type TiffRenderer } from './tiff-contract.js';
import { isEmf, isWmf, renderWmfToBitmap, wmfRasterTarget } from './wmf.js';

export interface DecodeRasterOptions {
  widthPt?: number;
  heightPt?: number;
  suppressBoundaryFrame?: boolean;
  tiff?: TiffRenderer;
  targetWidthPx?: number;
  targetHeightPx?: number;
  /** Retained base-surface ceiling. Effect pipelines lower this so their base
   * and derived surfaces fit the aggregate decoded-byte budget. */
  maxRetainedPixels?: number;
}

function exceedsRetainedBudget(source: RasterDimensions, pixelLimit: number): boolean {
  return source.width <= 0 || source.height <= 0
    || source.width > MAX_RASTER_DIMENSION || source.height > MAX_RASTER_DIMENSION
    || source.width * source.height > pixelLimit;
}

function decodeResizeOptions(
  source: RasterDimensions,
  targetWidthPx: number | undefined,
  targetHeightPx: number | undefined,
  pixelLimit = MAX_RASTER_PIXELS,
): ImageBitmapOptions | null {
  // Keep native decoding for already-safe inputs. Display-sized decoding is an
  // admission mechanism for sources/effect pipelines that exceed their retained
  // budget, avoiding a fidelity change for ordinary documents.
  if (!exceedsRetainedBudget(source, pixelLimit)) return null;
  if (typeof targetWidthPx !== 'number' || typeof targetHeightPx !== 'number') return null;
  if (!Number.isFinite(targetWidthPx) || !Number.isFinite(targetHeightPx)) return null;
  if (!(targetWidthPx > 0) || !(targetHeightPx > 0)) return null;
  const scale = Math.min(
    1,
    Math.max(targetWidthPx / source.width, targetHeightPx / source.height),
    MAX_RASTER_DIMENSION / source.width,
    MAX_RASTER_DIMENSION / source.height,
    Math.sqrt(pixelLimit / (source.width * source.height)),
  );
  if (!(scale < 1)) return null;
  // One axis lets the HTML algorithm preserve the oriented source aspect ratio
  // (including EXIF rotation) instead of imposing the coded header's W×H.
  return { resizeWidth: Math.max(1, Math.floor(source.width * scale)), resizeQuality: 'high' };
}

function rasterLimitError(
  dimensions: RasterDimensions,
  dimensionLimit: number,
  pixelLimit: number,
): OoxmlDecodedImageLimitError {
  const observedDimension = Math.max(dimensions.width, dimensions.height);
  if (!Number.isFinite(observedDimension) || observedDimension > dimensionLimit) {
    return new OoxmlDecodedImageLimitError(
      'image-dimension',
      dimensionLimit,
      Number.isFinite(observedDimension) ? observedDimension : Number.MAX_SAFE_INTEGER,
    );
  }
  const observedPixels = dimensions.width * dimensions.height;
  return new OoxmlDecodedImageLimitError(
    'image-pixels',
    pixelLimit,
    Number.isSafeInteger(observedPixels) && observedPixels >= 0
      ? observedPixels
      : Number.MAX_SAFE_INTEGER,
  );
}

export async function decodeRasterOrMetafile(
  data: Blob,
  opts: DecodeRasterOptions = {},
): Promise<ImageBitmap | null> {
  return decodeRasterOrMetafileWithInspection(data, opts);
}

/** Cache entry point for reusing metadata already inspected before key choice. */
export async function decodeRasterOrMetafileWithInspection(
  data: Blob,
  opts: DecodeRasterOptions = {},
  knownInspection?: RasterBlobInspection,
): Promise<ImageBitmap | null> {
  const {
    widthPt = 0,
    heightPt = 0,
    suppressBoundaryFrame = false,
    tiff,
    targetWidthPx,
    targetHeightPx,
    maxRetainedPixels = MAX_RASTER_PIXELS,
  } = opts;
  const retainedPixelLimit = Number.isSafeInteger(maxRetainedPixels) && maxRetainedPixels > 0
    ? Math.min(maxRetainedPixels, MAX_RASTER_PIXELS)
    : MAX_RASTER_PIXELS;
  const head = new Uint8Array(await data.slice(0, 64 * 1024).arrayBuffer());

  if (isWmf(head)) {
    const { w, h } = wmfRasterTarget(widthPt, heightPt);
    return enforceDecodedBitmapBudget(
      await renderWmfToBitmap(new Uint8Array(await data.arrayBuffer()), w, h, suppressBoundaryFrame),
      retainedPixelLimit,
    );
  }
  if (isEmf(head)) {
    const { w, h } = wmfRasterTarget(widthPt, heightPt);
    return enforceDecodedBitmapBudget(
      await renderEmfToBitmap(new Uint8Array(await data.arrayBuffer()), w, h),
      retainedPixelLimit,
    );
  }

  const inspection = knownInspection ?? await inspectRasterBlob(data, head);
  const rasterDimensions = inspection.dimensions;
  if (rasterDimensions && sourceRasterExceedsBudget(rasterDimensions)) {
    throw rasterLimitError(rasterDimensions, MAX_RASTER_SOURCE_DIMENSION, MAX_RASTER_SOURCE_PIXELS);
  }
  const resizeOptions = rasterDimensions
    ? decodeResizeOptions(rasterDimensions, targetWidthPx, targetHeightPx, retainedPixelLimit)
    : null;
  const tiffInput = isTiff(head);
  if (rasterDimensions && exceedsRetainedBudget(rasterDimensions, retainedPixelLimit)
    && (!resizeOptions || tiffInput)) {
    throw rasterLimitError(rasterDimensions, MAX_RASTER_DIMENSION, retainedPixelLimit);
  }
  if (tiffInput) {
    if (!tiff) return null;
    return enforceDecodedBitmapBudget(
      await tiff.render(new Uint8Array(await data.arrayBuffer())),
      retainedPixelLimit,
    );
  }
  return enforceDecodedBitmapBudget(
    resizeOptions ? await createImageBitmap(data, resizeOptions) : await createImageBitmap(data),
    retainedPixelLimit,
  );
}

function enforceDecodedBitmapBudget(
  bitmap: ImageBitmap | null,
  pixelLimit = MAX_RASTER_PIXELS,
): ImageBitmap | null {
  if (!bitmap) return null;
  const dimensions = { width: Number(bitmap.width), height: Number(bitmap.height) };
  if (!exceedsRetainedBudget(dimensions, pixelLimit)) return bitmap;
  closeImageBitmapIfSupported(bitmap);
  throw rasterLimitError(dimensions, MAX_RASTER_DIMENSION, pixelLimit);
}
