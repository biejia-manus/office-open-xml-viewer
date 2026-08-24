import type { ViewerCommentRect } from '../comment-decoration.js';

/** Measure an element in a Viewer-owned surface's CSS-pixel coordinate space. */
export function relativeElementRect(
  element: Element,
  surface: Element,
): ViewerCommentRect | undefined {
  const rect = element.getBoundingClientRect();
  const origin = surface.getBoundingClientRect();
  if (![rect.left, rect.top, rect.width, rect.height, origin.left, origin.top].every(Number.isFinite)) {
    return undefined;
  }
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  return Object.freeze({
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  });
}
