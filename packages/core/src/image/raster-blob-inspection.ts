import { sniffRasterDimensions, type RasterDimensions } from './raster-dimensions.js';
import { isTiff } from './tiff-contract.js';

export type RasterFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tiff';

export interface RasterBlobInspection {
  readonly format: RasterFormat | null;
  readonly dimensions: RasterDimensions | null;
}

const INITIAL_SNIFF_BYTES = 64 * 1024;

function rasterFormat(head: Uint8Array): RasterFormat | null {
  if (head.length >= 8
    && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
    && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) return 'png';
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xd8) return 'jpeg';
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46
    && head[3] === 0x38 && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) return 'gif';
  if (head.length >= 2 && head[0] === 0x42 && head[1] === 0x4d) return 'bmp';
  if (head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46
    && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42
    && head[11] === 0x50) return 'webp';
  if (isTiff(head)) return 'tiff';
  return null;
}

function isJpegSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf
    && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * Find JPEG SOF dimensions without retaining the compressed image in a JS
 * ArrayBuffer. JPEG permits arbitrarily many APP/ICC segments before SOF, so a
 * fixed prefix is not a security boundary. The state machine consumes the Blob
 * stream once, skips segment payloads, and stops at SOF or SOS/EOI.
 */
async function streamJpegDimensions(blob: Blob): Promise<RasterDimensions | null> {
  const reader = blob.slice(2).stream().getReader();
  let sawMarkerPrefix = false;
  let marker = -1;
  let lengthHi = -1;
  let skip = 0;
  let sofPayload: number[] | null = null;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return null;
      for (const byte of value) {
        if (sofPayload) {
          sofPayload.push(byte);
          if (sofPayload.length === 5) {
            const height = (sofPayload[1] << 8) | sofPayload[2];
            const width = (sofPayload[3] << 8) | sofPayload[4];
            await reader.cancel();
            return { width, height };
          }
          continue;
        }
        if (skip > 0) {
          skip--;
          continue;
        }
        if (marker >= 0) {
          if (lengthHi < 0) {
            lengthHi = byte;
            continue;
          }
          const segmentLength = (lengthHi << 8) | byte;
          if (segmentLength < 2) return null;
          if (isJpegSof(marker)) {
            if (segmentLength < 7) return null;
            sofPayload = [];
          } else {
            skip = segmentLength - 2;
          }
          marker = -1;
          lengthHi = -1;
          continue;
        }
        if (!sawMarkerPrefix) {
          if (byte === 0xff) sawMarkerPrefix = true;
          continue;
        }
        if (byte === 0xff) continue;
        sawMarkerPrefix = false;
        if (byte === 0x00) continue;
        if (byte === 0xd9 || byte === 0xda) return null;
        if (byte === 0xd8 || byte === 0x01 || (byte >= 0xd0 && byte <= 0xd7)) continue;
        marker = byte;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function deepTiffDimensions(blob: Blob, head: Uint8Array): Promise<RasterDimensions | null> {
  if (head.length < 8 || !isTiff(head)) return null;
  const little = head[0] === 0x49;
  const headView = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const ifdOffset = headView.getUint32(4, little);
  if (!Number.isSafeInteger(ifdOffset) || ifdOffset < 8 || ifdOffset > blob.size - 2) return null;
  const countBytes = new Uint8Array(await blob.slice(ifdOffset, ifdOffset + 2).arrayBuffer());
  if (countBytes.length !== 2) return null;
  const count = new DataView(countBytes.buffer, countBytes.byteOffset, 2).getUint16(0, little);
  const directoryBytes = count * 12;
  if (ifdOffset + 2 + directoryBytes > blob.size) return null;
  const directory = new Uint8Array(
    await blob.slice(ifdOffset + 2, ifdOffset + 2 + directoryBytes).arrayBuffer(),
  );
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  let width: number | undefined;
  let height: number | undefined;
  for (let index = 0; index < count; index++) {
    const offset = index * 12;
    const tag = view.getUint16(offset, little);
    if (tag !== 256 && tag !== 257) continue;
    const type = view.getUint16(offset + 2, little);
    const valueCount = view.getUint32(offset + 4, little);
    if (valueCount !== 1 || (type !== 1 && type !== 3 && type !== 4)) return null;
    const value = type === 1
      ? view.getUint8(offset + 8)
      : type === 3
        ? view.getUint16(offset + 8, little)
        : view.getUint32(offset + 8, little);
    if (tag === 256) width = value;
    else height = value;
  }
  return width === undefined || height === undefined ? null : { width, height };
}

/** Inspect the declared raster grid before handing bytes to any decoder. */
export async function inspectRasterBlob(
  blob: Blob,
  initialHead?: Uint8Array,
): Promise<RasterBlobInspection> {
  const head = initialHead ?? new Uint8Array(
    await blob.slice(0, INITIAL_SNIFF_BYTES).arrayBuffer(),
  );
  const format = rasterFormat(head);
  if (!format) return { format: null, dimensions: null };
  const dimensions = sniffRasterDimensions(head);
  if (dimensions) return { format, dimensions };
  if (format === 'jpeg') return { format, dimensions: await streamJpegDimensions(blob) };
  if (format === 'tiff') return { format, dimensions: await deepTiffDimensions(blob, head) };
  return { format, dimensions: null };
}
