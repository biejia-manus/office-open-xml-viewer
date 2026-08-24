/** A synchronous DOM extension lifecycle owned by a Viewer surface. */
export interface ViewerDomMountHandle<Context> {
  /** Replace the immutable context without replacing the host or component root. */
  update(context: Context): void;
  /** Release framework roots, listeners, and other resources exactly once. */
  destroy(): void;
}

/**
 * Mount a framework or DOM component into a Viewer-owned stable host.
 *
 * The callback must return synchronously. Async work belongs inside the mount
 * and observes the `AbortSignal` carried by its context when one is provided.
 * The host is connected before the callback runs. If consumer code allocates a
 * framework root and then throws before returning its handle, it must dispose
 * that root before rethrowing; the viewer can only clean resources registered
 * through the supplied context until a handle has been returned.
 */
export type ViewerDomMount<Context> = (
  host: HTMLElement,
  initialContext: Context,
) => ViewerDomMountHandle<Context>;
