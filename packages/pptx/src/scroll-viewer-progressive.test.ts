import { afterEach, describe, expect, it, vi } from 'vitest';
import { PptxPresentation } from './presentation.js';
import { PptxScrollViewer } from './scroll-viewer.js';
import {
  FakePptxEngine,
  installDom,
  makeContainer,
  type FakeEl,
} from './scroll-viewer-test-dom.js';

const WIDTH = 9144000;
const HEIGHT = 5143500;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PptxScrollViewer progressive layout', () => {
  it('forwards lifecycle options and keeps the final scroll extent from first paint', async () => {
    installDom();
    const engine = new FakePptxEngine(8, WIDTH, HEIGHT);
    engine.setLayoutProgress(1, false);
    const load = vi.spyOn(PptxPresentation, 'load').mockResolvedValue(engine.asPres());
    const container = makeContainer();
    const viewer = new PptxScrollViewer(container as unknown as HTMLElement, {
      progressiveLayout: true,
    });

    const loading = viewer.load('deck.pptx');
    await vi.waitFor(() => expect(viewer.slideCount).toBe(8));
    const spacer = container.children[0]!.children[0]!.children[0]!;
    expect(parseFloat(spacer.style.height)).toBeGreaterThan(container.clientHeight);
    expect(viewer.slideCount).toBe(8);
    expect(viewer.availableSlideCount).toBe(1);
    expect(viewer.layoutComplete).toBe(false);
    expect(load).toHaveBeenCalledWith('deck.pptx', expect.objectContaining({
      progressiveLayout: true,
    }));

    engine.setLayoutProgress(8, true);
    await loading;
    await expect(viewer.waitUntilLayoutComplete()).resolves.toBeUndefined();
    expect(viewer.layoutComplete).toBe(true);
    viewer.destroy();
  });

  it('shows a per-slide loading state and emits the completion transition', async () => {
    installDom();
    const engine = new FakePptxEngine(4, WIDTH, HEIGHT);
    engine.setLayoutProgress(1, false);
    const onVisibleSlideChange = vi.fn();
    const container = makeContainer();
    const viewer = PptxScrollViewer.fromPresentation(
      container as unknown as HTMLElement,
      engine.asPres(),
      { overscan: 3, onVisibleSlideChange },
    ) as PptxScrollViewer;
    const slots = (viewer as unknown as { _slots: Map<number, { loadingLayer: FakeEl }> })._slots;

    expect(slots.get(1)?.loadingLayer.style.display).toBe('flex');
    expect(onVisibleSlideChange).toHaveBeenLastCalledWith(0, 4, false);

    engine.setLayoutProgress(4, true);
    await vi.waitFor(() => expect(slots.get(1)?.loadingLayer.style.display).toBe('none'));
    expect(onVisibleSlideChange).toHaveBeenLastCalledWith(0, 4, true);
    viewer.destroy();
  });
});
