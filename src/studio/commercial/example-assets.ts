/** These bundled example files are private behind the commercial asset route. */
export const COMMERCIAL_EXAMPLE_ASSETS = {
  logo: '/commercial-assets/examples/benin-tv-logo.png',
  voice: '/commercial-assets/examples/benin-tv-example-fr-v2.wav',
  music: '/commercial-assets/examples/benin-tv-example-music-v1.wav',
  legacyVoice: '/commercial-assets/examples/benin-tv-example-fr.wav',
} as const;

export function isCommercialExampleAsset(url: string, kind: 'image' | 'audio'): boolean {
  return kind === 'image'
    ? url === COMMERCIAL_EXAMPLE_ASSETS.logo
    : url === COMMERCIAL_EXAMPLE_ASSETS.voice
      || url === COMMERCIAL_EXAMPLE_ASSETS.music
      || url === COMMERCIAL_EXAMPLE_ASSETS.legacyVoice;
}
