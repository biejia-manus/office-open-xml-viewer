import { describe, expect, it } from 'vitest';
import { DomInteractionBoundary } from './dom-interaction-boundary.js';

describe('DomInteractionBoundary', () => {
  it('reference-counts a portal root shared by multiple mounted cards', () => {
    const boundary = new DomInteractionBoundary();
    const child = {} as Node;
    const root = { contains: (candidate: Node) => candidate === child } as Node;
    const unregisterFirst = boundary.register(root);
    const unregisterSecond = boundary.register(root);

    expect(boundary.containsNode(child)).toBe(true);
    unregisterFirst();
    expect(boundary.containsNode(child)).toBe(true);
    unregisterSecond();
    expect(boundary.containsNode(child)).toBe(false);
  });
});
