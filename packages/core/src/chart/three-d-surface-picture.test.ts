import { describe, expect, it } from 'vitest';
import type { ImageFill } from '../types/common.js';
import { paintChartThreeDSurfacePicture } from './three-d-surface-picture.js';

function paint(fill: ImageFill): { draws: unknown[][]; transforms: number[][] } {
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
  const image = { width: 100, height: 100 } as unknown as CanvasImageSource;
  const painted = paintChartThreeDSurfacePicture(
    ctx,
    fill,
    image,
    { thicknessPercent: 0, pictureOptions: { pictureFormat: 'stretch' } },
    'backWall',
    {
      thickness: 0,
      inner: [
        { x: 0, y: 100, depth: 0 },
        { x: 100, y: 100, depth: 0 },
        { x: 100, y: 0, depth: 0 },
        { x: 0, y: 0, depth: 0 },
      ],
      outer: [],
      faces: [],
    },
    [0],
    point => ({ x: point.x, y: point.y }),
    10,
  );
  expect(painted).toBe(true);
  return { draws, transforms };
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
