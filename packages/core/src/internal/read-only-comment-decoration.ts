import type {
  ViewerCommentDecorationContext,
  ViewerCommentDecorationMount,
} from '../comment-decoration.js';
import type { ViewerDomMountHandle } from '../dom-mount.js';

interface DecorationState {
  readonly abort: AbortController;
  readonly mount: unknown;
  readonly handle: ViewerDomMountHandle<ViewerCommentDecorationContext>;
}

const stateByLayer = new WeakMap<HTMLDivElement, DecorationState>();

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function report(error: unknown, onError?: (error: Error) => void): void {
  const normalized = asError(error);
  if (!onError) throw normalized;
  try {
    onError(normalized);
  } catch (callbackError) {
    console.error('[ooxml] comment decoration error handler failed:', callbackError);
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null &&
    'then' in value && typeof (value as { then?: unknown }).then === 'function';
}

function isMountHandle(value: unknown): value is ViewerDomMountHandle<ViewerCommentDecorationContext> {
  return typeof value === 'object' && value !== null &&
    typeof (value as { update?: unknown }).update === 'function' &&
    typeof (value as { destroy?: unknown }).destroy === 'function';
}

export function disposeReadOnlyCommentDecoration(
  layer: HTMLDivElement,
  onError?: (error: Error) => void,
): void {
  const state = stateByLayer.get(layer);
  stateByLayer.delete(layer);
  if (!state) {
    layer.replaceChildren();
    return;
  }
  state.abort.abort();
  try {
    state.handle.destroy();
  } catch (error) {
    report(error, onError);
  } finally {
    layer.replaceChildren();
  }
}

/** Reconcile one transparent decoration surface without replacing its host. */
type WithoutSignal<Context> = Context extends unknown ? Omit<Context, 'signal'> : never;

export function buildReadOnlyCommentDecoration<Context extends ViewerCommentDecorationContext>(
  layer: HTMLDivElement,
  snapshot: WithoutSignal<Context>,
  mount: ViewerCommentDecorationMount<Context> | undefined,
  onError?: (error: Error) => void,
): void {
  let state = stateByLayer.get(layer);
  if (!mount) {
    if (state) disposeReadOnlyCommentDecoration(layer, onError);
    return;
  }
  if (state && state.mount !== mount) {
    disposeReadOnlyCommentDecoration(layer, onError);
    state = undefined;
  }
  if (!state) {
    const host = layer.ownerDocument.createElement('div');
    host.style.cssText = 'position:absolute;inset:0;overflow:visible;pointer-events:none;';
    // React/Vue adapters may synchronously require a connected mount point.
    layer.replaceChildren(host);
    const abort = new AbortController();
    const context = Object.freeze({ ...snapshot, signal: abort.signal }) as unknown as Context;
    let result: unknown;
    try {
      result = mount(host, context);
      if (isPromiseLike(result)) {
        throw new TypeError(
          'commentUi.mountDecoration must return synchronously; start async work from the supplied AbortSignal',
        );
      }
      if (!isMountHandle(result)) {
        throw new TypeError('commentUi.mountDecoration must return an object with update() and destroy()');
      }
    } catch (error) {
      abort.abort();
      host.remove();
      report(error, onError);
      return;
    }
    state = {
      abort,
      mount,
      handle: result as unknown as ViewerDomMountHandle<ViewerCommentDecorationContext>,
    };
    stateByLayer.set(layer, state);
    return;
  }
  try {
    state.handle.update(
      Object.freeze({ ...snapshot, signal: state.abort.signal }) as unknown as Context,
    );
  } catch (error) {
    report(error, onError);
  }
}
