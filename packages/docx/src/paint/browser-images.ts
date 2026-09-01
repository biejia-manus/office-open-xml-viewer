import {
  captureDecodedBitmapCacheEpoch,
  decodedBitmapTargetResizeOptions,
  duotoneImageData,
  MAX_RASTER_PIXELS,
  dropCachedDerivedBitmapNamespace,
  getCachedBitmapByPath,
  getCachedDerivedBitmap,
  getCachedSvgImageByPath,
  metafileRasterSize,
  preferVectorBlip,
  resolvedCachedBitmapVariantKey,
  sourceRasterTargetSize,
} from '@silurus/ooxml-core';
import type { Duotone, TiffRenderer } from '@silurus/ooxml-core';
import type {
  DeepReadonly,
  ImagePaintResourceDescriptor,
  PaintResourceDescriptor,
  RasterPaintOccurrence,
} from '../layout/types.js';

export type DecodedImage = ImageBitmap | HTMLImageElement;
export type DocxFetchImage = (path: string, mime: string) => Promise<Blob>;

interface ImageDecodeRequest {
  imagePath: string;
  mimeType: string;
  svgImagePath?: string;
  colorReplaceFrom?: string;
  duotone?: Duotone;
  widthPt: number;
  heightPt: number;
  hasCrop: boolean;
  targetWidthPx?: number;
  targetHeightPx?: number;
}

export function imageKey(
  imagePath: string,
  colorReplaceFrom?: string,
  duotone?: Duotone,
): string {
  const clr = colorReplaceFrom ? `|clr:${colorReplaceFrom}` : '';
  const duo = duotone ? `|duo:${duotone.clr1}:${duotone.clr2}` : '';
  return `${imagePath}${clr}${duo}`;
}

const DOCX_COLOR_EFFECT_CACHE_NAMESPACE = 'docx-color-effects';

export function dropBrowserImageCache(fetchImage: DocxFetchImage): void {
  dropCachedDerivedBitmapNamespace(fetchImage, DOCX_COLOR_EFFECT_CACHE_NAMESPACE);
}

function applyExactColorReplacement(data: ImageData, colorHex: string): void {
  const red = parseInt(colorHex.slice(0, 2), 16);
  const green = parseInt(colorHex.slice(2, 4), 16);
  const blue = parseInt(colorHex.slice(4, 6), 16);
  for (let index = 0; index < data.data.length; index += 4) {
    if (data.data[index] === red
      && data.data[index + 1] === green
      && data.data[index + 2] === blue) {
      data.data[index + 3] = 0;
    }
  }
}

async function applyColorEffects(
  bitmap: ImageBitmap,
  colorReplaceFrom: string | undefined,
  duotone: Duotone | undefined,
  failClosedOnDuotoneFailure: boolean,
  target?: Readonly<{ targetWidthPx: number; targetHeightPx: number }>,
): Promise<ImageBitmap | null> {
  const unavailable = async (error?: unknown): Promise<ImageBitmap | null> => {
    // clrChange has no compatibility pass-through: silently dropping its exact
    // alpha transform would change authored content. Duotone-only consumers
    // retain their established compatibility behavior, but at the requested
    // display resolution; strict chart consumers still fail closed.
    if (colorReplaceFrom) {
      throw error instanceof Error
        ? error
        : new Error('2D canvas is unavailable for image color effects');
    }
    if (failClosedOnDuotoneFailure) return null;
    const resizeOptions = decodedBitmapTargetResizeOptions(
      bitmap.width,
      bitmap.height,
      target?.targetWidthPx,
      target?.targetHeightPx,
    );
    if (!resizeOptions) return bitmap;
    if (typeof createImageBitmap === 'undefined') {
      throw new Error('createImageBitmap is unavailable for duotone fallback resampling');
    }
    return createImageBitmap(bitmap, resizeOptions);
  };
  if (typeof OffscreenCanvas === 'undefined') return unavailable();
  let offscreen: OffscreenCanvas;
  let context: OffscreenCanvasRenderingContext2D | null;
  try {
    offscreen = new OffscreenCanvas(bitmap.width, bitmap.height);
    context = offscreen.getContext('2d');
  } catch (error) {
    return unavailable(error);
  }
  if (!context) return unavailable();
  context.drawImage(bitmap, 0, 0);
  let imageData: ImageData;
  try {
    imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
  } catch (error) {
    return unavailable(error);
  }
  if (colorReplaceFrom) applyExactColorReplacement(imageData, colorReplaceFrom);
  if (duotone) {
    try {
      duotoneImageData(imageData, duotone.clr1, duotone.clr2);
    } catch {
      // The exact clrChange mutation already lives in this one source-grid
      // buffer. Compatibility mode preserves and resamples that current result;
      // strict chart consumers must not draw it without the authored duotone.
      if (failClosedOnDuotoneFailure) return null;
    }
  }
  context.putImageData(imageData, 0, 0);
  const resizeOptions = decodedBitmapTargetResizeOptions(
    bitmap.width,
    bitmap.height,
    target?.targetWidthPx,
    target?.targetHeightPx,
  );
  return resizeOptions
    ? createImageBitmap(offscreen, resizeOptions)
    : createImageBitmap(offscreen);
}

export async function decodeRaster(
  imagePath: string,
  mimeType: string,
  colorReplaceFrom: string | undefined,
  fetchImage: DocxFetchImage,
  widthPt = 0,
  heightPt = 0,
  duotone?: Duotone,
  failClosedOnDuotoneFailure = false,
  tiff?: TiffRenderer,
  target?: Readonly<{ targetWidthPx: number; targetHeightPx: number }>,
): Promise<ImageBitmap | null> {
  // Pixel effects temporarily retain more than their cached input/output:
  // source + offscreen backing + ImageData + result = four surfaces. clrChange
  // and duotone mutate the same ImageData before the one final bitmap bake, so
  // chaining them does not add another full-size intermediate.
  const effectSurfaceCount = colorReplaceFrom || duotone ? 4 : 1;
  const maxRetainedPixels = Math.floor(MAX_RASTER_PIXELS / effectSurfaceCount);
  const epoch = colorReplaceFrom || duotone
    ? captureDecodedBitmapCacheEpoch(fetchImage, DOCX_COLOR_EFFECT_CACHE_NAMESPACE)
    : undefined;
  const sourceBitmapOptions = {
    widthPt,
    heightPt,
    suppressBoundaryFrame: true,
    tiff,
    maxRetainedPixels,
  };
  const base = await getCachedBitmapByPath(imagePath, mimeType, fetchImage, {
    ...sourceBitmapOptions,
    ...(!colorReplaceFrom && !duotone ? target ?? {} : {}),
  });
  if (!base) return null;
  if (!colorReplaceFrom && !duotone) return base;
  const resolvedBaseKey = await resolvedCachedBitmapVariantKey(
    imagePath,
    mimeType,
    fetchImage,
    sourceBitmapOptions,
    epoch,
    base,
  );
  const resizeOptions = decodedBitmapTargetResizeOptions(
    base.width,
    base.height,
    target?.targetWidthPx,
    target?.targetHeightPx,
  );
  const key = `${imageKey(resolvedBaseKey, colorReplaceFrom, duotone)}${resizeOptions ? `|resize-width:${resizeOptions.resizeWidth}` : ''}${failClosedOnDuotoneFailure ? '|strict' : ''}`;
  return getCachedDerivedBitmap(
    DOCX_COLOR_EFFECT_CACHE_NAMESPACE,
    key,
    fetchImage,
    async () => {
      const bitmap = await applyColorEffects(
        base,
        colorReplaceFrom,
        duotone,
        failClosedOnDuotoneFailure,
        target,
      );
      return { bitmap, owned: bitmap !== null && bitmap !== base };
    },
    epoch,
  );
}

function imageDecodeRequests(
  descriptors: readonly DeepReadonly<PaintResourceDescriptor>[],
  rasterPaintOccurrences: readonly DeepReadonly<RasterPaintOccurrence>[],
  devicePixelsPerPoint?: number,
): ImageDecodeRequest[] {
  const requests = new Map<string, ImageDecodeRequest>();
  const demandByResource = new Map<string, { widthPt: number; heightPt: number }>();
  for (const occurrence of rasterPaintOccurrences) {
    if (occurrence.resourceKind !== 'image' && occurrence.resourceKind !== 'picture-bullet') {
      continue;
    }
    if (!Number.isFinite(occurrence.widthPt) || occurrence.widthPt <= 0
      || !Number.isFinite(occurrence.heightPt) || occurrence.heightPt <= 0) continue;
    const key = `${occurrence.resourceKind}:${occurrence.resourceKey}`;
    const prior = demandByResource.get(key);
    demandByResource.set(key, {
      widthPt: Math.max(prior?.widthPt ?? 0, occurrence.widthPt),
      heightPt: Math.max(prior?.heightPt ?? 0, occurrence.heightPt),
    });
  }
  const images = descriptors
    .filter((descriptor): descriptor is DeepReadonly<ImagePaintResourceDescriptor> => (
      descriptor.kind === 'image' || descriptor.kind === 'picture-bullet'
    ))
    .sort((left, right) => (
      (left.documentOrder ?? Number.MAX_SAFE_INTEGER)
      - (right.documentOrder ?? Number.MAX_SAFE_INTEGER)
    ));
  for (const image of images) {
    const demand = demandByResource.get(`${image.kind}:${image.resourceKey}`);
    if (!demand) continue;
    const raster = metafileRasterSize(
      image.mimeType,
      image.srcRect,
      demand.widthPt,
      demand.heightPt,
    );
    if (!raster) continue;
    const request: ImageDecodeRequest = {
      imagePath: image.partPath,
      mimeType: image.mimeType,
      ...(image.svgImagePath === undefined ? {} : { svgImagePath: image.svgImagePath }),
      ...(image.colorReplaceFrom === undefined ? {} : { colorReplaceFrom: image.colorReplaceFrom }),
      ...(image.duotone === undefined ? {} : { duotone: image.duotone as Duotone }),
      widthPt: raster.widthPt,
      heightPt: raster.heightPt,
      hasCrop: image.srcRect != null,
    };
    const target = devicePixelsPerPoint === undefined
      ? null
      : sourceRasterTargetSize(
          demand.widthPt * devicePixelsPerPoint,
          demand.heightPt * devicePixelsPerPoint,
          image.srcRect,
        );
    if (target) {
      request.targetWidthPx = target.width;
      request.targetHeightPx = target.height;
    }
    const key = imageKey(request.imagePath, request.colorReplaceFrom, request.duotone);
    const existing = requests.get(key);
    if (!existing) {
      requests.set(key, request);
    } else {
      existing.widthPt = Math.max(existing.widthPt, request.widthPt);
      existing.heightPt = Math.max(existing.heightPt, request.heightPt);
      existing.hasCrop ||= request.hasCrop;
      existing.targetWidthPx = Math.max(existing.targetWidthPx ?? 0, request.targetWidthPx ?? 0) || undefined;
      existing.targetHeightPx = Math.max(existing.targetHeightPx ?? 0, request.targetHeightPx ?? 0) || undefined;
    }
  }
  return [...requests.values()];
}

export async function preloadPaintImages(
  descriptors: readonly DeepReadonly<PaintResourceDescriptor>[],
  rasterPaintOccurrences: readonly DeepReadonly<RasterPaintOccurrence>[],
  fetchImage: DocxFetchImage | undefined,
  tiff?: TiffRenderer,
  devicePixelsPerPoint?: number,
  svgDecoder?: import('@silurus/ooxml-core').SvgBlobDecoder,
): Promise<Map<string, DecodedImage>> {
  if (!fetchImage) return new Map();
  const decodeSvg = (path: string, request: ImageDecodeRequest) => svgDecoder
    ? getCachedSvgImageByPath(path, fetchImage, {
        targetWidthPx: request.targetWidthPx,
        targetHeightPx: request.targetHeightPx,
        workerDecoder: svgDecoder,
      })
    : getCachedSvgImageByPath(path, fetchImage);
  const entries = await Promise.all(imageDecodeRequests(
    descriptors,
    rasterPaintOccurrences,
    devicePixelsPerPoint,
  ).map(async (request) => {
    const dataIsSvg = request.mimeType === 'image/svg+xml';
    const blip = { svgImagePath: request.svgImagePath, srcRect: request.hasCrop || null };
    let image: DecodedImage | null;
    if (preferVectorBlip(blip)) {
      try {
        image = await decodeSvg(blip.svgImagePath, request);
      } catch (vectorError) {
        const fallback = dataIsSvg
          ? await decodeSvg(request.imagePath, request)
          : await decodeRaster(
              request.imagePath,
              request.mimeType,
              request.colorReplaceFrom,
              fetchImage,
              request.widthPt,
              request.heightPt,
              request.duotone,
              false,
              tiff,
              request.targetWidthPx && request.targetHeightPx
                ? { targetWidthPx: request.targetWidthPx, targetHeightPx: request.targetHeightPx }
                : undefined,
            );
        if (!fallback) throw vectorError;
        image = fallback;
      }
    } else if (dataIsSvg) {
      image = await decodeSvg(request.imagePath, request);
    } else {
      image = await decodeRaster(
        request.imagePath,
        request.mimeType,
        request.colorReplaceFrom,
        fetchImage,
        request.widthPt,
        request.heightPt,
        request.duotone,
        false,
        tiff,
        request.targetWidthPx && request.targetHeightPx
          ? { targetWidthPx: request.targetWidthPx, targetHeightPx: request.targetHeightPx }
          : undefined,
      );
    }
    return image == null
      ? null
      : [imageKey(request.imagePath, request.colorReplaceFrom, request.duotone), image] as const;
  }));
  return new Map(entries.filter((entry): entry is readonly [string, DecodedImage] => entry !== null));
}
