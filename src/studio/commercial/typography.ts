import {fontData, fontFamily} from '../typography-fonts';
import type {CommercialPage} from './model';

const builtinFonts: Record<string, string> = {
  benin: '/commercial-assets/BeninSemiBold-Regular.otf',
  suisse: '/commercial-assets/SuisseIntl-Regular.otf',
};
const loading = new Map<string, Promise<void>>();

/** Keep the template face for “original”; share Graphics font identities otherwise. */
export function commercialFontFamily(choice: string | undefined, fallback: string): string {
  return choice && (Object.hasOwn(builtinFonts, choice) || /^local-font:[a-f0-9]{64}$/.test(choice)) ? fontFamily(choice) : fallback;
}

export function commercialTextCase(text: string, choice: 'typed' | 'upper' | 'lower' | undefined): string {
  return choice === 'upper' ? text.toLocaleUpperCase('fr') : choice === 'lower' ? text.toLocaleLowerCase('fr') : text;
}

async function loadFont(id: string, name?: string): Promise<void> {
  if (!loading.has(id)) {
    const pending = (async () => {
      let file: Blob;
      if (id.startsWith('local-font:')) {
        try {file = (await fontData(id)).file;}
        catch {throw new Error(`La police${name ? ` « ${name} »` : ' importée'} est absente de ce poste. Importez-la à nouveau dans Mise en forme du texte.`);}
      } else {
        const response = await fetch(builtinFonts[id], {credentials: 'same-origin'});
        if (!response.ok) throw new Error('La police sélectionnée est indisponible. Rechargez l’annonce.');
        file = await response.blob();
      }
      const face = await new FontFace(fontFamily(id), await file.arrayBuffer()).load();
      document.fonts.add(face);
    })().catch(error => {loading.delete(id); throw error;});
    loading.set(id, pending);
  }
  await loading.get(id);
}

/** Fonts remain local; commercial accounts never request Graphics template assets. */
export async function loadCommercialFonts(pages: readonly CommercialPage[], signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const selected = new Map<string, string | undefined>();
  for (const page of pages) {
    const style = page.style;
    for (const [id, name] of [[style?.titleFont, style?.titleFontName], [style?.bodyFont, style?.bodyFontName]]) {
      if (id && (Object.hasOwn(builtinFonts, id) || /^local-font:[a-f0-9]{64}$/.test(id))) selected.set(id, name);
    }
  }
  // A shared font load survives cancellation of one preview, so the next preview
  // can reuse it. The cancelled caller never continues to measure or draw text.
  await Promise.all([...selected].map(([id, name]) => loadFont(id, name)));
  signal?.throwIfAborted();
}
