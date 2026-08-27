import { afterEach, describe, expect, it, vi } from 'vitest';
import { excludeEmbeddedFontFamilies, loadEmbeddedFonts } from './embedded-fonts.js';
import type { PptxEmbeddedFontRef } from './worker-protocol';

const globals = globalThis as Record<string, unknown>;
const original = { document: globals.document, self: globals.self, FontFace: globals.FontFace };

afterEach(() => {
  globals.document = original.document;
  globals.self = original.self;
  globals.FontFace = original.FontFace;
  vi.restoreAllMocks();
});

function installFontFaceSet() {
  const added: Array<{ family: string; source: ArrayBuffer; descriptors: FontFaceDescriptors }> = [];
  class FakeFontFace {
    constructor(
      public family: string,
      public source: ArrayBuffer,
      public descriptors: FontFaceDescriptors,
    ) {}
    load() { return Promise.resolve(this); }
  }
  globals.FontFace = FakeFontFace;
  globals.document = { fonts: { add: (face: typeof added[number]) => added.push(face), ready: Promise.resolve() } };
  delete globals.self;
  return added;
}

const bytes = () => new Uint8Array([0, 1, 0, 0, 1]);

describe('loadEmbeddedFonts (ECMA-376 §19.2.1.9 / §15.2.13)', () => {
  it('maps all four PresentationML slots to CSS weight and style', async () => {
    const added = installFontFaceSet();
    const refs: PptxEmbeddedFontRef[] = ['regular', 'bold', 'italic', 'boldItalic'].map(
      (style, index) => ({
        fontName: 'Deck Sans',
        style: style as PptxEmbeddedFontRef['style'],
        partPath: `ppt/fonts/font${index + 1}.fntdata`,
        contentType: 'application/x-font-ttf',
      }),
    );
    await loadEmbeddedFonts(refs, async () => bytes());
    expect(added.map((face) => `${face.descriptors.weight}/${face.descriptors.style}`).sort()).toEqual([
      'bold/italic', 'bold/normal', 'normal/italic', 'normal/normal',
    ]);
    expect(added.every((face) => face.family === 'Deck Sans')).toBe(true);
  });

  it('keeps raw PPTX bytes and skips an unreadable part without aborting siblings', async () => {
    const added = installFontFaceSet();
    const refs: PptxEmbeddedFontRef[] = [
      { fontName: 'Good', style: 'regular', partPath: 'ppt/fonts/good.fntdata', contentType: 'application/x-font-ttf' },
      { fontName: 'Missing', style: 'regular', partPath: 'ppt/fonts/missing.fntdata', contentType: 'application/x-fontdata' },
    ];
    await loadEmbeddedFonts(refs, async (path) => {
      if (path.includes('missing')) throw new Error('missing');
      return bytes();
    });
    expect(added.map((face) => face.family)).toEqual(['Good']);
    expect(Array.from(new Uint8Array(added[0].source))).toEqual(Array.from(bytes()));
  });

  it('does not fetch when there are no embedded fonts', async () => {
    installFontFaceSet();
    const fetchFont = vi.fn(async () => bytes());
    await loadEmbeddedFonts([], fetchFont);
    expect(fetchFont).not.toHaveBeenCalled();
  });

  it('keeps embedded families ahead of optional Google-font substitutes', () => {
    const refs: PptxEmbeddedFontRef[] = [{
      fontName: 'Calibri',
      style: 'regular',
      partPath: 'ppt/fonts/font1.fntdata',
      contentType: 'application/x-font-ttf',
    }];
    expect(excludeEmbeddedFontFamilies(['Aptos', 'calibri', null], refs)).toEqual(['Aptos', null]);
  });
});
