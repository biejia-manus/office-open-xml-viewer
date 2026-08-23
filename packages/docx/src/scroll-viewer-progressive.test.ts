import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocxScrollViewer } from './scroll-viewer.js';
import {
  FakeDocxEngine,
  installDom,
  makeContainer,
  type FakeEl,
} from './scroll-viewer-test-dom.js';

// ─────────────────────────────────────────────────────────────────────────────
// Progressive layout hands the viewer a document whose page count GROWS: it
// mounts the provisional opening pages, then relays out when the authoritative
// layout lands. The virtualization math already takes the heights array fresh
// on every pass, so what needs pinning is the viewer's side of that contract —
// the scroll extent tracks the new page count, the mounted window is unchanged
// for pages the user is already looking at, and scroll position survives.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE = [{ widthPt: 612, heightPt: 792 }];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function spacerOf(container: FakeEl): FakeEl {
  return container.children[0].children[0].children[0];
}

describe('DocxScrollViewer — growing page count', () => {
  it('extends the scroll region when layout completes', () => {
    installDom();
    const container = makeContainer(700, 500);
    // Two provisional pages, as a preview publishes.
    const engine = new FakeDocxEngine(2, PAGE);
    const viewer = DocxScrollViewer.fromDocument(
      container as unknown as HTMLElement,
      engine.asDoc(),
    );
    const provisionalHeight = parseFloat(spacerOf(container).style.height);
    expect(viewer.pageCount).toBe(2);
    expect(provisionalHeight).toBeGreaterThan(0);

    // The authoritative layout arrives.
    engine.setPageCount(80);
    viewer.relayout();

    expect(viewer.pageCount).toBe(80);
    const finalHeight = parseFloat(spacerOf(container).style.height);
    expect(finalHeight).toBeGreaterThan(provisionalHeight);
    viewer.destroy();
  });

  it('keeps the pages already on screen mounted across the handover', () => {
    installDom();
    const container = makeContainer(700, 500);
    const engine = new FakeDocxEngine(2, PAGE);
    const viewer = DocxScrollViewer.fromDocument(
      container as unknown as HTMLElement,
      engine.asDoc(),
    );
    const mountedBefore = viewer.topVisiblePage;
    expect(mountedBefore).toBe(0);

    engine.setPageCount(80);
    viewer.relayout();

    // Growing the document must not scroll the user somewhere else.
    expect(viewer.topVisiblePage).toBe(mountedBefore);
    viewer.destroy();
  });

  it('repaints pages in place when the layout underneath them is replaced', () => {
    installDom();
    const container = makeContainer(700, 500);
    const engine = new FakeDocxEngine(2, PAGE);
    const viewer = DocxScrollViewer.fromDocument(
      container as unknown as HTMLElement,
      engine.asDoc(),
    );
    const paintedProvisionally = engine.renderCalls.length;
    expect(paintedProvisionally).toBeGreaterThan(0);

    // A plain relayout must NOT repaint: that guard is what keeps scrolling
    // cheap.
    viewer.relayout();
    expect(engine.renderCalls.length).toBe(paintedProvisionally);

    // Replacing the layout must, because a page's content can change without
    // its index changing (a footer's PAGE/NUMPAGES total, for one).
    (viewer as unknown as { _invalidateRenderedSlots(): void })._invalidateRenderedSlots();
    engine.setPageCount(80);
    viewer.relayout();
    expect(engine.renderCalls.length).toBeGreaterThan(paintedProvisionally);
    viewer.destroy();
  });

  it('does not mount the whole document just because it grew', () => {
    installDom();
    const container = makeContainer(700, 500);
    const engine = new FakeDocxEngine(2, PAGE);
    const viewer = DocxScrollViewer.fromDocument(
      container as unknown as HTMLElement,
      engine.asDoc(),
      { overscan: 1 },
    );
    engine.setPageCount(400);
    viewer.relayout();

    const scrollHost = container.children[0].children[0];
    const canvases = scrollHost.children.filter(
      (child: FakeEl) => child.children.some((nested: FakeEl) => nested.tag === 'canvas'),
    );
    // Virtualization still applies: a 400-page document mounts a viewport's
    // worth of slots, not 400.
    expect(canvases.length).toBeGreaterThan(0);
    expect(canvases.length).toBeLessThan(10);
    viewer.destroy();
  });
});
