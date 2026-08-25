import { afterEach, describe, expect, it, vi } from 'vitest';
import { XlsxViewer } from './viewer.js';
import type { XlsxComment, Worksheet } from './types.js';
import { installDom, makeContainer, type FakeEl } from './viewer-destroy-test-dom.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('XlsxViewer comment UI contract', () => {
  it('returns detached comments for application-owned current-sheet UI', () => {
    installDom();
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement);
    const internals = viewer as unknown as { currentWorksheet: Worksheet };
    internals.currentWorksheet = {
      name: 'Sheet 1', rows: [], colWidths: {}, rowHeights: {},
      defaultColWidth: 64, defaultRowHeight: 20, mergeCells: [],
      comments: [{ cellRef: 'A1', author: 'Ada', text: 'Review this' }],
    } as unknown as Worksheet;

    const comments = viewer.getComments();
    expect(comments).toEqual([{ cellRef: 'A1', author: 'Ada', text: 'Review this' }]);
    (comments[0] as XlsxComment).text = 'Changed by the caller';
    expect(viewer.getComments()[0]?.text).toBe('Review this');
    viewer.destroy();
  });

  it.each([
    { direction: 'LTR', rightToLeft: false },
    { direction: 'RTL', rightToLeft: true },
  ])('exposes $direction forward cell geometry for an application-owned anchored UI', ({ rightToLeft }) => {
    installDom();
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement);
    const internals = viewer as unknown as { currentWorksheet: Worksheet; canvasArea: FakeEl };
    internals.currentWorksheet = {
      name: 'Sheet 1', rows: [], colWidths: {}, rowHeights: {},
      defaultColWidth: 64, defaultRowHeight: 20, mergeCells: [],
      rightToLeft,
    } as unknown as Worksheet;
    internals.canvasArea.clientWidth = 800;

    const rect = viewer.getCellViewportRect('B2');
    expect(rect).not.toBeNull();
    expect(rect?.width).toBeGreaterThan(0);
    expect(rect?.height).toBeGreaterThan(0);
    expect(viewer.getCellAt(
      (rect?.x ?? 0) + (rect?.width ?? 0) / 2,
      (rect?.y ?? 0) + (rect?.height ?? 0) / 2,
    )).toEqual({ row: 2, col: 2 });
    expect(viewer.getCellViewportRect('not-a-cell')).toBeNull();
    viewer.destroy();
  });

  it('renders a structured, themeable built-in popup', () => {
    const dom = installDom();
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement);
    const internals = viewer as unknown as {
      currentSheet: number;
      renderCommentPopup(cell: { row: number; col: number }, comment: XlsxComment): void;
      _cellRect(row: number, col: number): { x: number; y: number; w: number; h: number };
      canvasArea: FakeEl;
      scrollHost: FakeEl;
      commentPopup: FakeEl;
    };
    internals.currentSheet = 0;
    internals.canvasArea.clientWidth = 800;
    internals.canvasArea.clientHeight = 600;
    internals._cellRect = () => ({ x: 20, y: 30, w: 80, h: 20 });
    const comment: XlsxComment = {
      kind: 'thread',
      cellRef: 'B2',
      id: '{root}',
      author: 'Ada',
      date: '2026-08-20T09:00:00Z',
      rootText: 'Review',
      text: 'Review\nDone',
      replies: [{
        id: '{reply}', parentId: '{root}', personId: '{person}', author: 'Grace',
        date: '2026-08-21T09:00:00Z', text: 'Done',
      }],
    };

    internals.renderCommentPopup({ row: 2, col: 2 }, comment);

    const styles = dom.head.querySelector('style[data-ooxml-comment-styles]');
    expect(styles?.textContent).toContain(':where(.ooxml-comment-card)');
    expect(styles?.textContent).toContain(':where(.ooxml-comment-marker)');
    expect(styles?.textContent).toContain('.ooxml-comment-card[data-active="true"]');

    expect(internals.commentPopup.dataset.ooxmlCommentUi).toBe('popup');
    expect(internals.commentPopup.dataset.ooxmlCommentCard).toBe('');
    expect(internals.commentPopup.getAttribute('class')).toBe('ooxml-comment-card');
    expect(internals.commentPopup.style.cssText).toContain('--ooxml-comment-author-accent:');
    expect(internals.commentPopup.style.cssText).not.toContain('background:');
    expect(internals.commentPopup.style.cssText).not.toContain('border-radius:');
    expect(internals.commentPopup.children[0]?.dataset.ooxmlCommentPart).toBe('comment');
    expect(internals.commentPopup.children[1]?.dataset.ooxmlCommentPart).toBe('reply');
    expect(internals.commentPopup.children[1]?.getAttribute('class')).toBe(
      'ooxml-comment-card__reply',
    );
    expect(internals.commentPopup.children[2]?.dataset.ooxmlCommentPart).toBe('frame');
    expect(internals.commentPopup.children[2]?.style.cssText).toBe('');
    expect(internals.commentPopup.children[0]?.children[0]?.children[0]?.children[0]?.textContent).toBe('Ada');
    expect(internals.commentPopup.children[0]?.children[0]?.children[0]?.children[1]?.dataset.ooxmlCommentPart).toBe('date');
    expect(internals.commentPopup.children[0]?.children[0]?.children[0]?.children[1]?.getAttribute('class')).toBe('ooxml-comment-card__date');
    expect(internals.commentPopup.children[1]?.children[0]?.children[0]?.children[0]?.textContent).toBe('Grace');
    expect(internals.commentPopup.children[1]?.children[0]?.children[1]?.textContent).toBe('Done');
    expect(internals.commentPopup.dataset.standalone).toBe('true');
    expect(internals.commentPopup.style.pointerEvents).toBe('');
    expect(internals.commentPopup.style.display).toBe('block');
    internals.renderCommentPopup({ row: 2, col: 2 }, comment);
    expect(dom.head.children.filter((child) =>
      child.dataset.ooxmlCommentStyles !== undefined)).toHaveLength(1);
    viewer.destroy();
  });

  it('applies the same authored visibility policy to popup data and markers', () => {
    installDom();
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement, {
      comments: { includeResolved: false },
    });
    const internals = viewer as unknown as {
      createVisibleSheetView(source: Worksheet): Worksheet;
    };
    const source = {
      name: 'Sheet 1', rows: [], colWidths: {}, rowHeights: {},
      defaultColWidth: 64, defaultRowHeight: 20, mergeCells: [],
      commentRefs: ['A1', 'B2'],
      comments: [
        { kind: 'thread', cellRef: 'A1', text: 'Open', resolved: false },
        { kind: 'thread', cellRef: 'B2', text: 'Closed', resolved: true },
      ],
    } as unknown as Worksheet;

    const visible = internals.createVisibleSheetView(source);
    expect(visible.commentRefs).toEqual(['A1']);
    expect(visible.comments?.map((comment) => comment.cellRef)).toEqual(['A1']);
    viewer.destroy();
  });

  it('keeps resolved XLSX comments visible by default for compatibility', () => {
    installDom();
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement);
    const internals = viewer as unknown as {
      createVisibleSheetView(source: Worksheet): Worksheet;
    };
    const source = {
      name: 'Sheet 1', rows: [], colWidths: {}, rowHeights: {},
      defaultColWidth: 64, defaultRowHeight: 20, mergeCells: [],
      commentRefs: ['B2'],
      comments: [{ kind: 'thread', cellRef: 'B2', text: 'Closed', resolved: true }],
    } as unknown as Worksheet;

    expect(internals.createVisibleSheetView(source).commentRefs).toEqual(['B2']);
    viewer.destroy();
  });
});
