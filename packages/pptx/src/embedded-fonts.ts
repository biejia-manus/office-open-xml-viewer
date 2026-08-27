import { registerEmbeddedFonts, type EmbeddedFontFace } from '@silurus/ooxml-core';
import type { PptxEmbeddedFontRef } from './worker-protocol';

/**
 * Load PresentationML font parts and register them before text measurement.
 * PPTX font parts are raw sfnt or EOT (ECMA-376 Part 1 §15.2.13), never the
 * WordprocessingML ODTTF obfuscation format.
 */
export async function loadEmbeddedFonts(
  refs: readonly PptxEmbeddedFontRef[],
  fetchFontBytes: (partPath: string) => Promise<Uint8Array>,
): Promise<FontFace[]> {
  if (refs.length === 0) return [];
  const faces = await Promise.all(refs.map(async (ref): Promise<EmbeddedFontFace | null> => {
    try {
      return {
        family: ref.fontName,
        bytes: await fetchFontBytes(ref.partPath),
        odttf: false,
        weight: ref.style === 'bold' || ref.style === 'boldItalic' ? 'bold' : 'normal',
        style: ref.style === 'italic' || ref.style === 'boldItalic' ? 'italic' : 'normal',
      };
    } catch {
      return null;
    }
  }));
  const loadable = faces.filter((face): face is EmbeddedFontFace => face !== null);
  return loadable.length === 0 ? [] : registerEmbeddedFonts(loadable);
}

/** Do not register a web substitute for a family supplied by the deck itself. */
export function excludeEmbeddedFontFamilies(
  names: readonly (string | null)[],
  refs: readonly PptxEmbeddedFontRef[],
): (string | null)[] {
  const embedded = new Set(refs.map((ref) => ref.fontName.trim().toLowerCase()));
  return names.filter((name) => name === null || !embedded.has(name.trim().toLowerCase()));
}
