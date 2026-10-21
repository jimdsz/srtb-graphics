import type {LegacyGraphic,Track} from './video/engine';

/** Lightweight media access; preview must not import the offline encoder. */
export function tracksOf(g:LegacyGraphic):Record<string,Track>{
  return g.tracks instanceof Map?Object.fromEntries(g.tracks):g.tracks||g.media?.tracks||{};
}
