import { describe, expect, it } from 'vitest';
import {
  planChartThreeDSurfacePicture,
  surfacePictureFaceIsEnabled,
} from './three-d-surface-picture-plan.js';

const fill = {
  fillType: 'image' as const,
  imagePath: 'xl/media/surface.png',
  mimeType: 'image/png',
  stretch: true,
};

describe('positive-thickness CT_Surface picture faces', () => {
  it.each([
    ['front', { applyToFront: true, applyToSides: false, applyToEnd: false }, [0]],
    ['sides', { applyToFront: false, applyToSides: true, applyToEnd: false }, [3, 5]],
    ['end', { applyToFront: false, applyToSides: false, applyToEnd: true }, [2, 4]],
  ] as const)('maps %s to its independently authored slab face class', (_name, flags, faces) => {
    const plan = planChartThreeDSurfacePicture(fill, {
      thicknessPercent: 25,
      pictureOptions: { ...flags, pictureFormat: 'stretch' },
    }, 'backWall', 10);
    expect(plan).not.toBeNull();
    if (!plan) throw new Error('picture plan not built');
    expect(Array.from({ length: 6 }, (_, index) => surfacePictureFaceIsEnabled(plan, index)))
      .toEqual(Array.from({ length: 6 }, (_, index) => faces.some(face => face === index)));
  });

  it('treats omitted face flags as enabled and keeps unmeasured slab formats fail-closed', () => {
    const stretch = planChartThreeDSurfacePicture(fill, {
      thicknessPercent: 25,
      pictureOptions: { pictureFormat: 'stretch' },
    }, 'sideWall', 10);
    expect(stretch).not.toBeNull();
    if (!stretch) throw new Error('picture plan not built');
    expect(Array.from({ length: 6 }, (_, index) => surfacePictureFaceIsEnabled(stretch, index)))
      .toEqual([true, false, true, true, true, true]);
    expect(planChartThreeDSurfacePicture(fill, {
      thicknessPercent: 25,
      pictureOptions: { pictureFormat: 'stackScale', pictureStackUnit: 2 },
    }, 'sideWall', 10)).toBeNull();
  });
});
