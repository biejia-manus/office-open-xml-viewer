import { describe, expect, it } from 'vitest';
import { readOnlyCommentConnectorPath } from './read-only-comment-decoration.js';

describe('readOnlyCommentConnectorPath', () => {
  const start = { x: 100, y: 40 };
  const end = { x: 240, y: 120 };

  it('builds solid bezier and orthogonal routes', () => {
    expect(readOnlyCommentConnectorPath(start, end, 'bezier')).toContain(' C ');
    const orthogonal = readOnlyCommentConnectorPath(start, end, 'orthogonal');
    expect(orthogonal).toContain(' H ');
    expect(orthogonal).toContain(' V ');
  });

  it('routes toward a left-side card rather than bending right first', () => {
    const path = readOnlyCommentConnectorPath(
      { x: 200, y: 40 },
      { x: 40, y: 120 },
      'bezier',
    );
    expect(path).toContain('C 120 40, 120 120, 40 120');
  });
});
