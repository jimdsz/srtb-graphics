/** Portable project contract. This file is also imported by the Worker. */
export const COMMERCIAL_TEMPLATE_ID = 'COMMUNIQUES_ORIGINAL_AMELIORE';
export const COMMERCIAL_FPS = 29.97;
export const COMMERCIAL_WIDTH = 1920;
export const COMMERCIAL_HEIGHT = 1080;
export const COMMERCIAL_PAGE_NAMES = ['Central', 'Gauche', 'Droite', 'Final'] as const;
export const COMMERCIAL_BODY_LIMITS = [420, 550, 360, 550] as const;
/** Rendered body rows, measured with the selected font; draft text stays intact. */
export const COMMERCIAL_MAX_TEXT_LINES = 3;
export const COMMERCIAL_READABLE_BODY_LIMIT = 12000;
export const COMMERCIAL_THEMES = ['vert', 'beige', 'jaune'] as const;
export const COMMERCIAL_DURATIONS = [60, 75, 90] as const;
export const COMMERCIAL_LOGO_POSITIONS = ['bottom-right', 'bottom-center', 'top-right'] as const;
export const COMMERCIAL_MIN_DURATION = 15;
export const COMMERCIAL_MAX_DURATION = 600;
export const COMMERCIAL_OUTRO = 3.4666667;
export const COMMERCIAL_SEQUENCE_LAYOUTS = ['central', 'columns', 'left', 'right', 'final'] as const;
export const COMMERCIAL_SEQUENCE_NAMES = {central: 'Central', columns: 'Deux colonnes', left: 'Encart gauche', right: 'Encart droit', final: 'Encart final'} as const;
export const COMMERCIAL_MAX_SEQUENCES = 32;
export const COMMERCIAL_MIN_SEQUENCE_DURATION = 3;
export interface CommercialTextStyle {
  titleScale: number; bodyScale: number; lineHeight: number; tracking: number;
  align: 'left' | 'center' | 'right'; titleColor: string; bodyColor: string;
  titleFont?: string; bodyFont?: string; titleFontName?: string; bodyFontName?: string;
  titleBold?: boolean; bodyBold?: boolean; titleItalic?: boolean; bodyItalic?: boolean;
  titleCase?: 'typed' | 'upper' | 'lower'; bodyCase?: 'typed' | 'upper' | 'lower';
  titleX?: number; titleY?: number; bodyX?: number; bodyY?: number;
  titleRotation?: number; bodyRotation?: number;
}
export interface CommercialPage { title: string; body: string; style?: CommercialTextStyle }
export interface CommercialSequence {
  id: string; layout: typeof COMMERCIAL_SEQUENCE_LAYOUTS[number]; duration: number;
  /** One page, or left and right pages for the two-column layout. */
  pages: CommercialPage[];
}
export interface CommercialTextSlot {
  page: CommercialPage; index: number; sequenceIndex: number; slot: number;
  /** Native geometry, typography defaults and body limit. */
  kind: 0 | 1 | 2 | 3; label: string;
}
export interface CommercialSequenceSpan {
  id: string; layout: CommercialSequence['layout']; index: number;
  start: number; end: number; duration: number; pageIndices: number[];
}
export interface CommercialAudio {
  url: string; name: string; duration: number;
  /** Source in/out points; end=0 means the source's end. */
  start: number; end: number;
  /** Position in the announcement, in seconds. */
  delay: number; volume: number; loop: boolean; fadeIn: number; fadeOut: number;
}
export interface CommercialLogo {
  url: string; name: string; mode: 'original' | 'monochrome';
  presentation?: 'adaptive'; crop?: boolean; removeBackground?: boolean;
  /** Adaptive footer logos align automatically; free placement is an explicit opt-out. */
  alignment?: 'free';
  position: typeof COMMERCIAL_LOGO_POSITIONS[number]; scale: number;
  opacity?: number; offsetX?: number; offsetY?: number;
  plate?: 'auto' | 'showcase' | 'none' | 'white' | 'black' | 'gold' | 'green';
  motion?: 'none' | 'fade' | 'slide'; delay?: number;
}
export interface CommercialData {
  issuer: string; pages: CommercialPage[];
  /** Explicit opt-in; absent projects retain the original template rendering. */
  textMode?: 'summary' | 'full';
  /** Absent on legacy projects: their original timing and motion stay intact. */
  sequences?: CommercialSequence[]; sequenceTiming?: 'auto' | 'manual';
  theme: typeof COMMERCIAL_THEMES[number]; duration: number; durationMode?: 'voice' | 'manual';
  voice: CommercialAudio | null; music: CommercialAudio | null; logo: CommercialLogo | null; demo: boolean;
  signatureEnabled: boolean; signatureVolume: number;
}
export const DEFAULT_COMMERCIAL_DATA: CommercialData = {
  issuer: '', theme: 'vert', duration: 60, durationMode: 'manual', demo: false, voice: null, music: null, logo: null,
  signatureEnabled: true, signatureVolume: 1,
  pages: [{title: 'COMMUNIQUÉ', body: ''}, {title: 'AU PROGRAMME', body: ''}, {title: 'POUR TOUS', body: ''}, {title: 'RENDEZ-VOUS', body: ''}],
};
export function commercialBodyLimit(data: Pick<CommercialData, 'textMode'>, kind: number): number {
  return data.textMode ? COMMERCIAL_READABLE_BODY_LIMIT : COMMERCIAL_BODY_LIMITS[kind];
}
/** A reading floor, not a speech transcript alignment. Both columns need reading time. */
export function commercialSequenceReadingDuration(sequence: CommercialSequence): number {
  const words = sequence.pages.reduce((sum, page) => sum + `${page.title} ${page.body}`.trim().split(/\s+/u).filter(Boolean).length, 0);
  return Math.max(5, 1.2 + words / 2.8);
}
type CommercialTimingInput = Pick<CommercialData, 'duration' | 'voice'> & Partial<Pick<CommercialData, 'sequences' | 'sequenceTiming' | 'textMode'>>;
const durationFrames = (seconds: number) => Math.ceil(seconds * COMMERCIAL_FPS - 1e-7);
/** Legacy voice timing is unchanged; sequences may extend it, never cut it. */
export function effectiveCommercialDuration(data: CommercialTimingInput): number {
  if (data.sequences?.length) {
    const first = Math.round(3.4 * COMMERCIAL_FPS), outro = durationFrames(COMMERCIAL_OUTRO);
    const manual = data.sequenceTiming === 'manual';
    const reading = data.sequences.reduce((sum, sequence) => sum + durationFrames(manual ? Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION, sequence.duration) : data.textMode ? commercialSequenceReadingDuration(sequence) : COMMERCIAL_MIN_SEQUENCE_DURATION), 0);
    const voiceEnd = data.voice ? durationFrames(Math.max(first / COMMERCIAL_FPS, data.voice.delay) + (data.voice.end || data.voice.duration) - data.voice.start) + outro : 0;
    const fallback = !data.voice && !manual ? Math.floor(data.duration * COMMERCIAL_FPS + 1e-7) : 0;
    return Math.max(durationFrames(COMMERCIAL_MIN_DURATION), first + reading + outro, voiceEnd, fallback) / COMMERCIAL_FPS;
  }
  if (!data.voice) return data.duration;
  const voice = data.voice, length = (voice.end || voice.duration) - voice.start;
  const first = Math.round(3.4 * COMMERCIAL_FPS) / COMMERCIAL_FPS;
  const readingEndFrame = Math.ceil((Math.max(first, voice.delay) + length) * COMMERCIAL_FPS - 1e-7);
  return Math.max(Math.ceil(COMMERCIAL_MIN_DURATION * COMMERCIAL_FPS), readingEndFrame + Math.ceil(COMMERCIAL_OUTRO * COMMERCIAL_FPS)) / COMMERCIAL_FPS;
}
export function commercialTimeline(value: number | CommercialTimingInput) {
  const duration = typeof value === 'number' ? value : effectiveCommercialDuration(value);
  const fps = COMMERCIAL_FPS, frames = Math.floor(duration * fps + 1e-7), seconds = frames / fps;
  const snap = (t: number) => Math.round(t * fps) / fps;
  const reading = seconds - 6.4;
  const firstStart = snap(3.4), closingStart = snap(seconds - COMMERCIAL_OUTRO), readingDuration = closingStart - firstStart;
  return {fps, frames, duration: seconds, firstStart, dualStart: snap(3.4 + reading * .306), finalStart: snap(3.4 + reading * .67), closingStart, readingDuration, motionScale: Math.min(1, readingDuration / 12)};
}
export function commercialSequenceKind(layout: CommercialSequence['layout'], slot = 0): 0 | 1 | 2 | 3 {
  return layout === 'central' ? 0 : layout === 'right' || layout === 'columns' && slot === 1 ? 2 : layout === 'final' ? 3 : 1;
}
/** Stable, flattened indices are shared by canvas selection and text editors. */
export function commercialTextSlots(data: CommercialData): CommercialTextSlot[] {
  if (!data.sequences) return data.pages.map((page, index) => ({page, index, sequenceIndex: index === 0 ? 0 : index === 3 ? 2 : 1, slot: index === 2 ? 1 : 0, kind: index as 0 | 1 | 2 | 3, label: COMMERCIAL_PAGE_NAMES[index]}));
  const slots: CommercialTextSlot[] = [];
  data.sequences.forEach((sequence, sequenceIndex) => sequence.pages.forEach((page, slot) => {
    const kind = commercialSequenceKind(sequence.layout, slot);
    slots.push({page, index: slots.length, sequenceIndex, slot, kind, label: `Séquence ${sequenceIndex + 1} · ${COMMERCIAL_PAGE_NAMES[kind]}`});
  }));
  return slots;
}
export function updateCommercialTextPage(data: CommercialData, index: number, page: CommercialPage): CommercialData {
  const slot = commercialTextSlots(data)[index]; if (!slot) return data;
  if (!data.sequences) return {...data, pages: data.pages.map((current, i) => i === index ? page : current)};
  return {...data, sequences: data.sequences.map((sequence, i) => i === slot.sequenceIndex ? {...sequence, pages: sequence.pages.map((current, j) => j === slot.slot ? page : current)} : sequence)};
}
/** Every boundary is an integer frame; rounding cannot accumulate lost time. */
export function commercialSequenceTimeline(data: CommercialData): CommercialSequenceSpan[] {
  const tl = commercialTimeline(data);
  if (!data.sequences) return [
    {id: 'legacy-central', layout: 'central', index: 0, start: tl.firstStart, end: tl.dualStart, duration: tl.dualStart - tl.firstStart, pageIndices: [0]},
    {id: 'legacy-columns', layout: 'columns', index: 1, start: tl.dualStart, end: tl.finalStart, duration: tl.finalStart - tl.dualStart, pageIndices: [1, 2]},
    {id: 'legacy-final', layout: 'final', index: 2, start: tl.finalStart, end: tl.closingStart, duration: tl.closingStart - tl.finalStart, pageIndices: [3]},
  ];
  if (!data.sequences.length) return [];
  const first = Math.round(tl.firstStart * tl.fps), closing = Math.round(tl.closingStart * tl.fps), available = closing - first;
  const count = data.sequences.length, manual = data.sequenceTiming === 'manual';
  let lengths = data.sequences.map((sequence, i) => manual ? durationFrames(Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION, sequence.duration)) : Math.floor(available / count) + Number(i < available % count));
  if (!manual && data.textMode) {
    const base = data.sequences.map(sequence => durationFrames(commercialSequenceReadingDuration(sequence)));
    const total = base.reduce((sum, value) => sum + value, 0), extra = Math.max(0, available - total);
    lengths = base.map(length => length + Math.floor(extra * length / total));
  }
  lengths[count - 1] += available - lengths.reduce((sum, length) => sum + length, 0);
  let frame = first, pageIndex = 0;
  return data.sequences.map((sequence, index) => {
    const start = frame / tl.fps; frame += lengths[index];
    const pageIndices = sequence.pages.map(() => pageIndex++);
    return {id: sequence.id, layout: sequence.layout, index, start, end: frame / tl.fps, duration: lengths[index] / tl.fps, pageIndices};
  });
}
/** Explicit conversion only; simply opening/saving an old project does not migrate it. */
export function createCommercialSequences(data: CommercialData): CommercialData {
  if (data.sequences) return data;
  const sequences = commercialSequenceTimeline(data).map(span => ({id: span.id, layout: span.layout, duration: Math.max(COMMERCIAL_MIN_SEQUENCE_DURATION, span.duration), pages: span.pageIndices.map(index => ({...data.pages[index], style: {...commercialPageStyle(data.pages[index], index)}}))}));
  return {...data, sequences, sequenceTiming: 'manual'};
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const numeric = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
export function commercialPageStyle(page: CommercialPage, index: number, readable = false): CommercialTextStyle {
  const s = record(page.style);
  const storedTitleColor=text(s.titleColor,index===0?'#f9fbf4':'#08150e');
  // This exact dark green was the built-in title color on the former pearl
  // headers. Resolve that preset to pearl on open reading layouts, while
  // retaining other authored colors and the original template's rendering.
  const titleColor=readable&&storedTitleColor.toLowerCase()==='#08150e'?'#f9fbf4':storedTitleColor;
  return {titleScale: numeric(s.titleScale, 1), bodyScale: numeric(s.bodyScale, 1), lineHeight: numeric(s.lineHeight, 1), tracking: numeric(s.tracking, -.01), align: s.align === 'center' || s.align === 'right' ? s.align : 'left', titleColor, bodyColor: text(s.bodyColor, index === 0 ? '#f9fbf4' : '#ffffff'), titleFont:text(s.titleFont,'original'), bodyFont:text(s.bodyFont,'original'), titleFontName:text(s.titleFontName), bodyFontName:text(s.bodyFontName), titleBold:s.titleBold===true, bodyBold:s.bodyBold===true, titleItalic:s.titleItalic===true, bodyItalic:s.bodyItalic===true, titleCase:s.titleCase==='upper'||s.titleCase==='lower'?s.titleCase:'typed', bodyCase:s.bodyCase==='upper'||s.bodyCase==='lower'?s.bodyCase:'typed', titleX:numeric(s.titleX,0),titleY:numeric(s.titleY,0),bodyX:numeric(s.bodyX,0),bodyY:numeric(s.bodyY,0),titleRotation:numeric(s.titleRotation,0),bodyRotation:numeric(s.bodyRotation,0)};
}
function audio(value: unknown, voice: boolean): CommercialAudio | null {
  if (!value) return null;
  const v = record(value);
  return {url: text(v.url), name: text(v.name), duration: numeric(v.duration, 0), start: numeric(v.start, 0), end: numeric(v.end, 0), delay: numeric(v.delay, voice ? commercialTimeline(60).firstStart : 0), volume: numeric(v.volume, voice ? 1 : .15), loop: voice ? false : v.loop === true, fadeIn: numeric(v.fadeIn, voice ? 0 : .5), fadeOut: numeric(v.fadeOut, voice ? 0 : 1)};
}
/** Recover a saved draft without retaining unrelated or obsolete properties. */
export function normalizeCommercialData(value: unknown): CommercialData {
  const v = record(value), logo = record(v.logo), pages = Array.isArray(v.pages) ? v.pages : [];
  return {
    issuer: text(v.issuer),
    ...(v.textMode === 'summary' || v.textMode === 'full' ? {textMode: v.textMode} : {}),
    pages: COMMERCIAL_PAGE_NAMES.map((_, i) => {const p = record(pages[i]); const page = {title: text(p.title, DEFAULT_COMMERCIAL_DATA.pages[i].title), body: text(p.body), style: p.style as CommercialTextStyle | undefined}; return {...page, style: commercialPageStyle(page, i)};}),
    ...(Array.isArray(v.sequences) ? {
      sequenceTiming: v.sequenceTiming === 'manual' ? 'manual' as const : 'auto' as const,
      sequences: v.sequences.map((value: unknown) => {
        const s = record(value), layout = COMMERCIAL_SEQUENCE_LAYOUTS.includes(s.layout as CommercialSequence['layout']) ? s.layout as CommercialSequence['layout'] : 'central';
        return {id: text(s.id), layout, duration: numeric(s.duration, 8), pages: (Array.isArray(s.pages) ? s.pages : []).map((value: unknown, slot: number) => {
          const p = record(value), kind = commercialSequenceKind(layout, slot), page = {title: text(p.title), body: text(p.body), style: p.style as CommercialTextStyle | undefined};
          return {...page, style: commercialPageStyle(page, kind)};
        })};
      }),
    } : {}),
    theme: COMMERCIAL_THEMES.includes(v.theme as CommercialData['theme']) ? v.theme as CommercialData['theme'] : 'vert',
    duration: numeric(v.duration, 60), durationMode: v.voice ? 'voice' : 'manual',
    voice: audio(v.voice, true), music: audio(v.music, false), demo: v.demo === true,
    signatureEnabled: v.signatureEnabled !== false, signatureVolume: numeric(v.signatureVolume, 1),
    logo: v.logo ? {url: text(logo.url), name: text(logo.name), ...(logo.presentation === 'adaptive' ? {presentation: 'adaptive' as const, crop: logo.crop !== false} : {}), ...(typeof logo.removeBackground === 'boolean' ? {removeBackground:logo.removeBackground} : {}), ...(logo.alignment === 'free' ? {alignment:'free' as const} : {}), mode: logo.mode === 'monochrome' ? 'monochrome' : 'original', position: COMMERCIAL_LOGO_POSITIONS.includes(logo.position as CommercialLogo['position']) ? logo.position as CommercialLogo['position'] : 'bottom-right', scale: numeric(logo.scale, 1), opacity: numeric(logo.opacity, 1), offsetX: numeric(logo.offsetX, 0), offsetY: numeric(logo.offsetY, 0), plate: ['auto','showcase','white','black','gold','green'].includes(String(logo.plate)) ? logo.plate as CommercialLogo['plate'] : 'none', motion: logo.motion === 'none' || logo.motion === 'slide' ? logo.motion : 'fade', delay: numeric(logo.delay, 0)} : null,
  };
}
/** Strict validation of the unnormalised data; drafts may keep empty text. */
export function validateCommercialData(value: unknown, options: {draft?: boolean} = {}): string[] {
  const v = record(value), errors: string[] = [];
  if (v.textMode !== undefined && v.textMode !== 'summary' && v.textMode !== 'full') errors.push('Choisissez Synthèse visuelle ou Texte intégral.');
  if (v.issuer !== undefined && (typeof v.issuer !== 'string' || v.issuer.length > 160)) errors.push('Le nom facultatif de l’annonceur est limité à 160 caractères.');
  if (!COMMERCIAL_THEMES.includes(v.theme as CommercialData['theme'])) errors.push('Choisissez un fond vert, beige ou jaune.');
  if (typeof v.duration !== 'number' || !Number.isFinite(v.duration) || v.duration < COMMERCIAL_MIN_DURATION || v.duration > COMMERCIAL_MAX_DURATION) errors.push('Choisissez une durée manuelle entre 15 secondes et 10 minutes.');
  if (v.durationMode !== undefined && v.durationMode !== 'voice' && v.durationMode !== 'manual') errors.push('Le mode de durée est invalide.');
  if (typeof v.demo !== 'boolean') errors.push('Le réglage de démonstration est invalide.');
  if (v.signatureEnabled !== undefined && typeof v.signatureEnabled !== 'boolean') errors.push('Le réglage du jingle d’ouverture est invalide.');
  if (v.signatureVolume !== undefined && (typeof v.signatureVolume !== 'number' || !Number.isFinite(v.signatureVolume) || v.signatureVolume < 0 || v.signatureVolume > 2)) errors.push('Le volume du jingle doit être compris entre 0 et 200 %.');
  const validatePage = (page: unknown, i: number, name: string) => {
    const p = record(page);
    if (typeof p.title !== 'string' || p.title.length > 34 || /[\r\n]/.test(p.title) || (!options.draft && !p.title.trim())) errors.push(`${name} : titre obligatoire, sur une ligne et limité à 34 caractères.`);
    const limit = v.textMode === 'summary' || v.textMode === 'full' ? COMMERCIAL_READABLE_BODY_LIMIT : COMMERCIAL_BODY_LIMITS[i];
    if (typeof p.body !== 'string' || p.body.length > limit || (!options.draft && !p.body.trim())) errors.push(`${name} : texte obligatoire, limité à ${limit} caractères.`);
    if (p.style !== undefined) {
      const s = record(p.style);
      for (const [field, minimum, maximum] of [['titleScale',.6,1.4],['bodyScale',.65,1.4],['lineHeight',.8,1.5],['tracking',-.05,.15]] as const) if (s[field] !== undefined && (typeof s[field] !== 'number' || !Number.isFinite(s[field]) || (s[field] as number) < minimum || (s[field] as number) > maximum)) errors.push(`${name} : réglage typographique ${field} invalide.`);
      if (s.align !== undefined && !['left','center','right'].includes(String(s.align))) errors.push(`${name} : alignement invalide.`);
      for (const field of ['titleColor','bodyColor']) if (s[field] !== undefined && (typeof s[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(s[field] as string))) errors.push(`${name} : couleur invalide.`);
      for (const target of ['title','body']) {
        const font=s[target+'Font']; if(font!==undefined&&(typeof font!=='string'||!['original','benin','suisse'].includes(font)&&!/^local-font:[a-f0-9]{64}$/.test(font)))errors.push(`${name} : police invalide.`);
        const fontName=s[target+'FontName'];if(fontName!==undefined&&(typeof fontName!=='string'||fontName.length>200||/[\x00-\x1f<>]/.test(fontName)))errors.push(`${name} : nom de police invalide.`);
        for(const field of ['Bold','Italic'])if(s[target+field]!==undefined&&typeof s[target+field]!=='boolean')errors.push(`${name} : style invalide.`);
        if(s[target+'Case']!==undefined&&!['typed','upper','lower'].includes(String(s[target+'Case'])))errors.push(`${name} : casse invalide.`);
        for(const [field,limit]of [['X',200],['Y',200],['Rotation',45]]as const){const setting=s[target+field];if(setting!==undefined&&(typeof setting!=='number'||!Number.isFinite(setting)||Math.abs(setting)>limit))errors.push(`${name} : position ou rotation hors limites.`);}
      }
    }
  };
  if (v.sequenceTiming !== undefined && v.sequenceTiming !== 'auto' && v.sequenceTiming !== 'manual') errors.push('Le minutage des séquences est invalide.');
  if (v.sequences === undefined) {
    if (!Array.isArray(v.pages) || v.pages.length !== 4) errors.push('Les quatre zones de texte sont nécessaires.');
    else v.pages.forEach((page: unknown, i: number) => validatePage(page, i, COMMERCIAL_PAGE_NAMES[i]));
  } else if (!Array.isArray(v.sequences) || v.sequences.length < 1 || v.sequences.length > COMMERCIAL_MAX_SEQUENCES) {
    errors.push(`Une annonce doit contenir entre 1 et ${COMMERCIAL_MAX_SEQUENCES} séquences.`);
  } else {
    const ids = new Set<string>();
    v.sequences.forEach((value: unknown, index: number) => {
      const s = record(value), name = `Séquence ${index + 1}`;
      if (typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(s.id) || ids.has(s.id)) errors.push(`${name} : identifiant absent ou dupliqué.`);
      if (typeof s.id === 'string') ids.add(s.id);
      const layout = s.layout as CommercialSequence['layout'];
      if (!COMMERCIAL_SEQUENCE_LAYOUTS.includes(layout)) errors.push(`${name} : disposition invalide.`);
      if (typeof s.duration !== 'number' || !Number.isFinite(s.duration) || s.duration < COMMERCIAL_MIN_SEQUENCE_DURATION || s.duration > COMMERCIAL_MAX_DURATION) errors.push(`${name} : la durée doit être comprise entre 3 et 600 secondes.`);
      if (!Array.isArray(s.pages) || s.pages.length !== (layout === 'columns' ? 2 : 1)) errors.push(`${name} : ${layout === 'columns' ? 'deux zones de texte sont nécessaires' : 'une zone de texte est nécessaire'}.`);
      else s.pages.forEach((page: unknown, slot: number) => {const kind = commercialSequenceKind(layout, slot); validatePage(page, kind, `${name} · ${COMMERCIAL_PAGE_NAMES[kind]}`);});
    });
    if (effectiveCommercialDuration(normalizeCommercialData(v)) > COMMERCIAL_MAX_DURATION + 1e-7) errors.push('Les séquences, la voix off et les signatures dépassent 10 minutes. Réduisez les durées ou sélectionnez une voix plus courte.');
  }
  for (const key of ['voice', 'music'] as const) {
    if (v[key] === null) continue;
    const a = record(v[key]), label = key === 'voice' ? 'Voix off' : 'Musique';
    if (typeof a.url !== 'string' || !a.url || a.url.length > 4096 || typeof a.name !== 'string' || a.name.length > 256) errors.push(`${label} : fichier invalide.`);
    for (const field of ['duration', 'start', 'end', 'delay', 'volume', 'fadeIn', 'fadeOut']) if (typeof a[field] !== 'number' || !Number.isFinite(a[field]) || (a[field] as number) < 0) errors.push(`${label} : réglage ${field} invalide.`);
    if ((a.duration as number) <= 0 || (a.duration as number) > 4 * 3600) errors.push(`${label} : durée du fichier invalide.`);
    if ((a.volume as number) > 2) errors.push(`${label} : volume limité à 200 %.`);
    if (typeof a.loop !== 'boolean' || (key === 'voice' && a.loop)) errors.push(`${label} : la voix off ne peut pas boucler.`);
    const start = a.start as number, end = (a.end as number) || (a.duration as number);
    if (end <= start || end > (a.duration as number) + .001) errors.push(`${label} : passage sélectionné hors du fichier.`);
    if (typeof v.duration === 'number' && Number.isFinite(v.duration)) {
      const tl = commercialTimeline(normalizeCommercialData(v)), available = (key === 'voice' ? tl.closingStart : tl.duration) - (key === 'voice' ? Math.max(tl.firstStart, a.delay as number) : a.delay as number);
      if (available <= 0) errors.push(`${label} : le départ dépasse l’annonce.`);
      if (key === 'voice' && tl.duration > COMMERCIAL_MAX_DURATION) errors.push('La voix off et les signatures dépassent 10 minutes. Sélectionnez un extrait plus court.');
    }
    if ((a.fadeIn as number) > 10 || (a.fadeOut as number) > 10) errors.push(`${label} : fondus limités à 10 secondes.`);
  }
  if (v.logo !== null) {
    const l = record(v.logo);
    if (typeof l.url !== 'string' || !l.url || l.url.length > 4096 || typeof l.name !== 'string' || l.name.length > 256) errors.push('Le fichier du logo est invalide.');
    if (!COMMERCIAL_LOGO_POSITIONS.includes(l.position as CommercialLogo['position'])) errors.push('Le logo est autorisé à droite ou en bas au centre ; le coin supérieur gauche est réservé.');
    if (l.mode !== 'original' && l.mode !== 'monochrome') errors.push('Le traitement du logo est invalide.');
    if (typeof l.scale !== 'number' || !Number.isFinite(l.scale) || l.scale < .25 || l.scale > 4) errors.push('La taille du logo doit être comprise entre 25 et 400 %.');
    for (const [field, minimum, maximum] of [['opacity',0,1],['offsetX',-600,600],['offsetY',-400,400],['delay',0,5]] as const) if (l[field] !== undefined && (typeof l[field] !== 'number' || !Number.isFinite(l[field]) || (l[field] as number) < minimum || (l[field] as number) > maximum)) errors.push(`Logo : réglage ${field} invalide.`);
    if (l.presentation !== undefined && l.presentation !== 'adaptive') errors.push('La présentation du logo est invalide.');
    if (l.alignment !== undefined && l.alignment !== 'free') errors.push('L’alignement du logo est invalide.');
    if (l.crop !== undefined && typeof l.crop !== 'boolean') errors.push('Le recadrage du logo est invalide.');
    if (l.removeBackground !== undefined && typeof l.removeBackground !== 'boolean') errors.push('Le détourage du logo est invalide.');
    if (l.plate !== undefined && !['auto','showcase','none','white','black','gold','green'].includes(String(l.plate))) errors.push('Le fond du logo est invalide.');
    if (l.motion !== undefined && !['none','fade','slide'].includes(String(l.motion))) errors.push('L’animation du logo est invalide.');
  }
  return errors;
}
