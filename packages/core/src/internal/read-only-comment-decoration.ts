/** Internal geometry used by the built-in DOCX/PPTX comment connectors. */
export interface ReadOnlyCommentRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ReadOnlyCommentThreadGeometry {
  readonly occurrenceKey: string;
  readonly active: boolean;
  readonly anchorRects: readonly ReadOnlyCommentRect[];
  readonly cardRect?: ReadOnlyCommentRect;
}

export interface ReadOnlyCommentDecorationSnapshot {
  readonly surfaceBounds: ReadOnlyCommentRect;
  readonly contentBounds: ReadOnlyCommentRect;
  readonly threads: readonly ReadOnlyCommentThreadGeometry[];
}

const SVG_NS = 'http://www.w3.org/2000/svg';

interface DecorationState {
  readonly svg: SVGSVGElement;
  readonly paths: Map<string, SVGPathElement>;
}

const stateByLayer = new WeakMap<HTMLDivElement, DecorationState>();

export function disposeReadOnlyCommentDecoration(layer: HTMLDivElement): void {
  stateByLayer.delete(layer);
  layer.replaceChildren();
}

/** Draw the built-in page/slide-to-card connectors in surface CSS pixels. */
export function buildReadOnlyCommentDecoration(
  layer: HTMLDivElement,
  snapshot: ReadOnlyCommentDecorationSnapshot,
): void {
  layer.dataset.ooxmlCommentConnectors = '';
  let state = stateByLayer.get(layer);
  if (!state) {
    const svg = layer.ownerDocument.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
    state = { svg, paths: new Map() };
    stateByLayer.set(layer, state);
    layer.replaceChildren(svg);
  }
  state.svg.setAttribute(
    'viewBox',
    `0 0 ${snapshot.surfaceBounds.width} ${snapshot.surfaceBounds.height}`,
  );

  const orderedPaths: SVGPathElement[] = [];
  const desired = new Set<string>();
  for (const thread of snapshot.threads) {
    const anchor = thread.anchorRects.at(-1);
    const card = thread.cardRect;
    if (!anchor || !card) continue;
    desired.add(thread.occurrenceKey);

    const startX = anchor.x + anchor.width;
    const startY = anchor.y + anchor.height / 2;
    const endX = card.x;
    const endY = card.y + Math.min(card.height / 2, 25);
    const elbowX = startX + (endX - startX) * 0.55;
    let path = state.paths.get(thread.occurrenceKey);
    if (!path) {
      path = layer.ownerDocument.createElementNS(SVG_NS, 'path');
      state.paths.set(thread.occurrenceKey, path);
    }
    path.dataset.ooxmlCommentConnector = thread.occurrenceKey;
    path.dataset.ooxmlCommentActive = String(thread.active);
    path.setAttribute(
      'd',
      `M ${startX} ${startY} H ${elbowX} V ${endY} H ${endX}`,
    );
    path.style.cssText =
      'fill:none;vector-effect:non-scaling-stroke;' +
      `stroke:${thread.active
        ? 'var(--ooxml-comment-connector-active,#2563eb)'
        : 'var(--ooxml-comment-connector,#94a3b8)'};` +
      `stroke-width:${thread.active
        ? 'var(--ooxml-comment-connector-active-width,1.5px)'
        : 'var(--ooxml-comment-connector-width,1px)'};` +
      `opacity:${thread.active
        ? 'var(--ooxml-comment-connector-active-opacity,.9)'
        : 'var(--ooxml-comment-connector-opacity,.45)'};`;
    orderedPaths.push(path);
  }

  for (const [key, path] of [...state.paths]) {
    if (desired.has(key)) continue;
    state.paths.delete(key);
    path.remove();
  }
  const orderChanged = orderedPaths.length !== state.svg.children.length ||
    orderedPaths.some((path, index) => state.svg.children[index] !== path);
  if (orderChanged) state.svg.replaceChildren(...orderedPaths);
}
