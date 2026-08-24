/** Viewer-owned interaction boundary that also accepts Portal/Teleport roots. */
export class DomInteractionBoundary {
  private readonly roots = new Map<Node, number>();

  register(root: Node): () => void {
    this.roots.set(root, (this.roots.get(root) ?? 0) + 1);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const count = this.roots.get(root) ?? 0;
      if (count <= 1) this.roots.delete(root);
      else this.roots.set(root, count - 1);
    };
  }

  contains(event: Event, dataAttribute: string): boolean {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    for (const candidate of path) {
      if (this.roots.has(candidate as Node)) return true;
      const dataset = (candidate as { dataset?: DOMStringMap }).dataset;
      if (dataset?.[dataAttribute] !== undefined) return true;
    }

    const target = event.target as Node | null;
    if (this.containsNode(target)) return true;
    let element = target as HTMLElement | null;
    while (element) {
      if (element.dataset?.[dataAttribute] !== undefined) return true;
      element = element.parentElement;
    }
    return false;
  }

  containsNode(target: Node | null): boolean {
    for (const root of this.roots.keys()) {
      if (root === target || (target !== null && root.contains(target))) return true;
    }
    return false;
  }

  clear(): void {
    this.roots.clear();
  }
}
