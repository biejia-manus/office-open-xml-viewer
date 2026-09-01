import { describe, expect, it, vi } from 'vitest';
import { PptxPresentation } from './presentation.js';
import type { PptxTextRunInfo } from './renderer.js';

function ownedBitmap() {
  const close = vi.fn();
  const bitmap = { width: 4, height: 3, close } as unknown as ImageBitmap;
  return { bitmap, close };
}

function workerPresentation(bitmap: ImageBitmap, runs: PptxTextRunInfo[]): PptxPresentation {
  const instance = Object.create(PptxPresentation.prototype) as Record<string, unknown>;
  Object.assign(instance, {
    _mode: 'worker',
    _resourceFailure: null,
    _bootstrap: { slideCount: 1 },
    _availableSlideCount: 1,
    _destroyed: false,
    _bridge: {
      request: vi.fn(async () => ({ kind: 'slideRendered', id: 1, bitmap, runs })),
    },
  });
  return instance as unknown as PptxPresentation;
}

describe('PptxPresentation worker bitmap callback ownership', () => {
  it('releases the received bitmap once and preserves the callback failure', async () => {
    const { bitmap, close } = ownedBitmap();
    const runs = [
      { text: 'first' },
      { text: 'second' },
    ] as PptxTextRunInfo[];
    const failure = new Error('text-run callback failed');
    const onTextRun = vi.fn((run: PptxTextRunInfo) => {
      if (run === runs[1]) throw failure;
    });
    const presentation = workerPresentation(bitmap, runs);

    await expect(presentation.renderSlideToBitmap(0, {
      width: 320,
      dpr: 1,
      onTextRun,
    })).rejects.toBe(failure);

    expect(onTextRun).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('hands the still-open bitmap to the caller after successful callback replay', async () => {
    const { bitmap, close } = ownedBitmap();
    const runs = [{ text: 'success' }] as PptxTextRunInfo[];
    const onTextRun = vi.fn();
    const presentation = workerPresentation(bitmap, runs);

    await expect(presentation.renderSlideToBitmap(0, {
      width: 320,
      dpr: 1,
      onTextRun,
    })).resolves.toBe(bitmap);

    expect(onTextRun).toHaveBeenCalledWith(runs[0]);
    expect(close).not.toHaveBeenCalled();
  });
});
