import { afterEach, describe, expect, it, vi } from 'vitest';
import { XlsxViewer } from './viewer.js';
import type { XlsxComment, Worksheet } from './types.js';
import type { XlsxCommentCardContext } from './comment-card.js';
import { installDom, makeContainer, type FakeEl } from './viewer-destroy-test-dom.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('XlsxViewer comment UI contract', () => {
  it('mounts a custom framework root once and updates it with a structured thread', () => {
    installDom();
    let mounts = 0;
    let updates = 0;
    let destroys = 0;
    let latest: XlsxCommentCardContext | undefined;
    let portal: FakeEl | undefined;
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement, {
      commentUi: {
        mountCard(host, context) {
          mounts++;
          expect(host.parentElement?.parentElement).not.toBeNull();
          latest = context;
          portal = host.ownerDocument.createElement('div') as unknown as FakeEl;
          context.registerInteractiveRoot(portal as unknown as Node);
          host.textContent = context.thread.root.text;
          return {
            update(next) {
              updates++;
              latest = next;
              host.textContent = next.thread.root.text;
            },
            destroy() {
              destroys++;
            },
          };
        },
      },
    });
    const internals = viewer as unknown as {
      currentSheet: number;
      renderCommentPopup(cell: { row: number; col: number }, comment: XlsxComment): void;
      getCellRect(row: number, col: number): { x: number; y: number; w: number; h: number };
      canvasArea: FakeEl;
      scrollHost: FakeEl;
      commentPopup: FakeEl;
    };
    internals.currentSheet = 0;
    Object.defineProperty(viewer, 'sheetNames', { value: ['Sheet 1'] });
    internals.canvasArea.clientWidth = 800;
    internals.canvasArea.clientHeight = 600;
    internals.getCellRect = () => ({ x: 20, y: 30, w: 80, h: 20 });
    const comment: XlsxComment = {
      kind: 'thread',
      cellRef: 'B2',
      id: '{root}',
      author: 'Ada',
      date: '2026-08-20T09:00:00Z',
      rootText: 'Review',
      text: 'Review\nDone',
      replies: [{
        id: '{reply}', parentId: '{root}', personId: '{person}', author: 'Grace', text: 'Done',
      }],
    };

    internals.renderCommentPopup({ row: 2, col: 2 }, comment);
    internals.renderCommentPopup({ row: 2, col: 2 }, comment);

    expect(mounts).toBe(1);
    expect(updates).toBe(1);
    expect(latest?.thread.occurrenceKey).toBe('sheet:0:{root}:B2');
    expect(latest?.thread.root.messageKey).toBe('sheet:0:{root}:B2:root');
    expect(latest?.thread.root.text).toBe('Review');
    expect(latest?.thread.replies[0]?.messageKey).toBe('sheet:0:{root}:B2:reply:{reply}');
    expect(latest?.thread.replies.map((reply) => reply.text)).toEqual(['Done']);
    expect(latest?.sheetName).toBe('Sheet 1');
    expect(latest?.cellRef).toBe('B2');
    expect(internals.commentPopup.style.pointerEvents).toBe('auto');
    expect(internals.commentPopup.style.display).toBe('block');

    // A framework-owned button must remain usable while the pointer crosses
    // from the worksheet into the popup, then close when that surface is left.
    internals.scrollHost.dispatch('pointerleave', { relatedTarget: portal });
    expect(internals.commentPopup.style.display).toBe('block');
    portal?.dispatch('pointerleave', { relatedTarget: null });
    expect(internals.commentPopup.style.display).toBe('none');
    viewer.destroy();
    expect(destroys).toBe(1);
    expect(latest?.signal.aborted).toBe(true);
  });

  it('applies the same authored visibility policy to popup data and markers', () => {
    installDom();
    const viewer = new XlsxViewer(makeContainer() as unknown as HTMLElement, {
      commentUi: { includeResolved: false },
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
