import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('./layouts/ApiPage.astro', import.meta.url), 'utf8');

describe('API page layout', () => {
  it('keeps the sticky contents navigation below the global header', () => {
    expect(page).toContain('position: sticky; top: 92px;');
    expect(page).toContain('@media (max-width: 820px)');
    expect(page).toContain('.api-toc { position: static; }');
  });
});
