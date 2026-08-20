import { describe, expect, it } from 'vitest';
import type { ImageFill } from '../types/common.js';
import { paintChartThreeDSurfacePicture } from './three-d-surface-picture.js';

function paint(
  fill: ImageFill,
  options: {
    imageWidth?: number;
    imageHeight?: number;
    faceWidth?: number;
    faceHeight?: number;
    pictureFormat?: 'stretch' | 'stack' | 'stackScale';
    projectXScale?: number;
    pictureStackAspect?: number;
  } = {},
): { painted: boolean; draws: unknown[][]; transforms: number[][] } {
  const transforms: number[][] = [];
  const draws: unknown[][] = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(_target, property: string) {
      if (property === 'getTransform') {
        return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      }
      if (property === 'setTransform') {
        return (...args: number[]) => transforms.push(args);
      }
      if (property === 'drawImage') {
        return (...args: unknown[]) => draws.push(args);
      }
      if (property in state) return state[property];
      return () => undefined;
    },
    set(_target, property: string, value) {
      state[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  const image = {
    width: options.imageWidth ?? 100,
    height: options.imageHeight ?? 100,
  } as unknown as CanvasImageSource;
  const faceWidth = options.faceWidth ?? 100;
  const faceHeight = options.faceHeight ?? 100;
  const painted = paintChartThreeDSurfacePicture(
    ctx,
    fill,
    image,
    {
      thicknessPercent: 0,
      pictureOptions: { pictureFormat: options.pictureFormat ?? 'stretch' },
    },
    'backWall',
    {
      thickness: 0,
      inner: [
        { x: 0, y: faceHeight, depth: 0 },
        { x: faceWidth, y: faceHeight, depth: 0 },
        { x: faceWidth, y: 0, depth: 0 },
        { x: 0, y: 0, depth: 0 },
      ],
      outer: [],
      faces: [],
      pictureStackAspect: options.pictureStackAspect
        ?? faceWidth * (options.projectXScale ?? 1) / faceHeight,
    },
    [0],
    point => ({ x: point.x * (options.projectXScale ?? 1), y: point.y }),
    10,
  );
  return { painted, draws, transforms };
}

const imageFill = {
  fillType: 'image' as const,
  imagePath: 'surface.png',
  mimeType: 'image/png',
  stretch: true,
};

describe('CT_Surface stretch source and destination rectangles', () => {
  it('maps the complete source into the authored projected fillRect', () => {
    const { draws, transforms } = paint({
      ...imageFill,
      fillRect: { l: 0.1, t: 0.2, r: 0.3, b: 0.1 },
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1, 5)).toEqual([0, 0, 100, 100]);
    expect(transforms).toHaveLength(1);
    expect(transforms[0][0]).toBeCloseTo(0.6, 6);
    expect(transforms[0][3]).toBeCloseTo(0.7, 6);
    expect(transforms[0][4]).toBeCloseTo(10, 6);
    expect(transforms[0][5]).toBeCloseTo(20, 6);
  });

  it('clips a negative fillRect outset at the complete face', () => {
    const { draws, transforms } = paint({
      ...imageFill,
      fillRect: { l: -0.25, t: 0, r: 0, b: 0 },
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1, 5)).toEqual([0, 0, 100, 100]);
    expect(transforms[0][0]).toBeCloseTo(1.25, 6);
    expect(transforms[0][4]).toBeCloseTo(-25, 6);
  });

  it('preserves transparent destination space for a negative srcRect outset', () => {
    const { draws, transforms } = paint({
      ...imageFill,
      srcRect: { l: -0.25, t: 0, r: 0, b: 0 },
    });
    expect(draws).toHaveLength(1);
    expect(draws[0].slice(1, 5)).toEqual([0, 0, 100, 100]);
    expect(transforms[0][0]).toBeCloseTo(0.8, 6);
    expect(transforms[0][4]).toBeCloseTo(20, 6);
  });
});

describe('CT_Surface plain stacked pictures', () => {
  it('preserves image aspect, anchors at the value-axis minimum, and repeats upward', () => {
    const one = paint(imageFill, {
      imageWidth: 400, imageHeight: 100,
      faceWidth: 400, faceHeight: 100,
      pictureFormat: 'stack',
    });
    expect(one.painted).toBe(true);
    expect(one.draws).toHaveLength(1);
    expect(one.transforms[0]).toEqual([1, 0, 0, 1, 0, 0]);

    const two = paint(imageFill, {
      imageWidth: 800, imageHeight: 100,
      faceWidth: 400, faceHeight: 100,
      pictureFormat: 'stack',
    });
    expect(two.painted).toBe(true);
    expect(two.draws).toHaveLength(2);
    expect(two.transforms.map(transform => transform[5])).toEqual([50, 0]);

    const clipped = paint(imageFill, {
      imageWidth: 200, imageHeight: 100,
      faceWidth: 400, faceHeight: 100,
      pictureFormat: 'stack',
    });
    expect(clipped.painted).toBe(true);
    expect(clipped.draws).toHaveLength(1);
    expect(clipped.transforms[0][3]).toBeCloseTo(2, 6);
    expect(clipped.transforms[0][5]).toBeCloseTo(-100, 6);
  });

  it('does not let authored DPI change plain stack geometry', () => {
    const low = paint({ ...imageFill, dpi: 48 }, {
      imageWidth: 800, imageHeight: 100,
      faceWidth: 400, faceHeight: 100,
      pictureFormat: 'stack',
    });
    const high = paint({ ...imageFill, dpi: 192 }, {
      imageWidth: 800, imageHeight: 100,
      faceWidth: 400, faceHeight: 100,
      pictureFormat: 'stack',
    });
    expect(low.transforms).toEqual(high.transforms);
  });

  it('derives aspect from the projected face rather than model-space depth', () => {
    const result = paint(imageFill, {
      imageWidth: 200, imageHeight: 100,
      faceWidth: 100, faceHeight: 100,
      pictureFormat: 'stack',
      projectXScale: 2,
    });
    expect(result.painted).toBe(true);
    expect(result.draws).toHaveLength(1);
  });

  it('shares the plot reference aspect with a differently shaped target wall', () => {
    const result = paint(imageFill, {
      imageWidth: 800, imageHeight: 100,
      faceWidth: 25, faceHeight: 100,
      pictureFormat: 'stack',
      pictureStackAspect: 4,
    });
    expect(result.painted).toBe(true);
    expect(result.draws).toHaveLength(2);
  });

  it('fails closed before drawing when aspect repetition exceeds the image-work ceiling', () => {
    const result = paint(imageFill, {
      imageWidth: 4_097 * 400, imageHeight: 100,
      faceWidth: 400, faceHeight: 100,
      pictureFormat: 'stack',
    });
    expect(result.painted).toBe(false);
    expect(result.draws).toHaveLength(0);
  });
});
