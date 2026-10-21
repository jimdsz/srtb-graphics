import type {CommercialLogo} from './model';
import {commercialLogoBounds, commercialLogoDimensions, commercialLogoPadding} from './logo-layout';
import type {CommercialLogoBounds, CommercialLogoSize} from './logo-layout';
import {removeCommercialLogoBackground} from './logo-background';

export interface CommercialLogoCrop {x: number; y: number; width: number; height: number}
export interface CommercialLogoAnalysis {
  crop: CommercialLogoCrop | null;
  hasTransparency: boolean;
  autoPlate: 'white' | 'black';
}
export interface CommercialLogoAsset extends CommercialLogoSize {
  image: ImageBitmap | HTMLCanvasElement;
  originalWidth: number; originalHeight: number; cropped: boolean;
  hasTransparency: boolean; autoPlate: 'white' | 'black';
  dispose(): void;
}

/**
 * Only exactly transparent pixels may be discarded. A white background, faint
 * anti-aliasing and shadows all remain part of the advertiser's artwork.
 */
export function analyzeCommercialLogoPixels(pixels: Uint8ClampedArray, width: number, height: number): CommercialLogoAnalysis {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || pixels.length !== width * height * 4) {
    throw new RangeError('Les dimensions du logo sont invalides.');
  }
  let left = width, top = height, right = -1, bottom = -1;
  let whiteContrast = 0, blackContrast = 0, alphaWeight = 0, fullyOpaque = true, edgeLuminance = 0, edgePixels = 0;
  const linear = (value: number) => {const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;};
  const channels = Array.from({length: 256}, (_, value) => linear(value));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4, alpha = pixels[at + 3];
    if (alpha !== 255) fullyOpaque = false;
    if (!alpha) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    const luminance = .2126 * channels[pixels[at]] + .7152 * channels[pixels[at + 1]] + .0722 * channels[pixels[at + 2]], weight = alpha / 255;
    // Cap the reward for already-legible pixels; prioritize the weak parts of
    // a multicolour mark rather than letting a dark outline dominate the choice.
    whiteContrast += Math.min(7, 1.05 / (luminance + .05)) * weight;
    blackContrast += Math.min(7, (luminance + .05) / .05) * weight;
    alphaWeight += weight;
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {edgeLuminance += luminance; edgePixels++;}
  }
  if (right < left || bottom < top) return {crop: null, hasTransparency: true, autoPlate: 'white'};
  let hasTransparency = false;
  for (let y = top; y <= bottom && !hasTransparency; y++) for (let x = left; x <= right; x++) {
    if (pixels[(y * width + x) * 4 + 3] < 250) {hasTransparency = true; break;}
  }
  const blendOpaqueBackground = fullyOpaque && edgePixels ? edgeLuminance / edgePixels : null;
  return {
    crop: {x: left, y: top, width: right - left + 1, height: bottom - top + 1},
    hasTransparency,
    autoPlate: blendOpaqueBackground !== null && blendOpaqueBackground > .8 ? 'white'
      : blendOpaqueBackground !== null && blendOpaqueBackground < .035 ? 'black'
      : alphaWeight && blackContrast > whiteContrast * 1.12 ? 'black' : 'white',
  };
}

export function commercialLogoQuality(logo: CommercialLogo, size: CommercialLogoSize): {enlarged: boolean; factor: number; message: string | null} {
  const display = commercialLogoDimensions(logo, size.width, size.height), factor = Math.max(display.width / size.width, display.height / size.height);
  return {enlarged: factor > 1.01, factor, message: factor > 1.01 ? `Ce logo est agrandi au-delà de sa définition (${size.width} × ${size.height} px utiles). Choisissez une image plus grande pour garder des contours nets.` : null};
}

export async function loadCommercialLogoAsset(setting: CommercialLogo, signal: AbortSignal): Promise<CommercialLogoAsset> {
  signal.throwIfAborted();
  let source: ImageBitmap | undefined, bitmap: ImageBitmap | undefined, canvas: HTMLCanvasElement | undefined;
  try {
    const response = await fetch(setting.url, {signal, credentials: 'same-origin'});
    if (!response.ok) throw Error('Le logo de l’annonceur est introuvable. Sélectionnez-le à nouveau.');
    source = await createImageBitmap(await response.blob()); signal.throwIfAborted();
    const originalWidth = source.width, originalHeight = source.height, adaptive = setting.presentation === 'adaptive';
    let analysis: CommercialLogoAnalysis = {crop: {x: 0, y: 0, width: originalWidth, height: originalHeight}, hasTransparency: false, autoPlate: 'white'};
    let backgroundStatus: CommercialLogoSize['backgroundStatus'] = 'disabled';
    // Full-size analysis retains one-pixel details and very faint outer pixels.
    // Bound work before allocating the RGBA buffer, with an actionable failure.
    if (adaptive && originalWidth * originalHeight > 32_000_000) throw Error('Ce logo dépasse 32 millions de pixels. Importez une version plus petite, en conservant sa transparence.');
    if (adaptive || setting.mode === 'monochrome' || setting.plate === 'showcase') {
      canvas = document.createElement('canvas');
      const factor = adaptive ? 1 : Math.min(1, 1024 / Math.max(originalWidth, originalHeight));
      canvas.width = Math.max(1, Math.round(originalWidth * factor)); canvas.height = Math.max(1, Math.round(originalHeight * factor));
      const context = canvas.getContext('2d', {willReadFrequently: true});
      if (!context) throw Error('L’analyse du logo est indisponible.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height), pixels = imageData.data;
      if (adaptive && setting.removeBackground === true) {
        const background = removeCommercialLogoBackground(pixels, canvas.width, canvas.height);
        backgroundStatus = background.status;
        if (background.status === 'removed') {pixels.set(background.pixels); context.putImageData(imageData, 0, 0);}
      }
      analysis = analyzeCommercialLogoPixels(pixels, canvas.width, canvas.height);
      if (adaptive && !analysis.crop) throw Error('Cette image est entièrement transparente. Choisissez un logo visible.');
      if (setting.mode === 'monochrome') {
        // Preserve the original legacy eligibility rule, including transparent
        // borders, while adaptive mode checks the actual visible artwork.
        const allowed = adaptive ? analysis.hasTransparency : pixels.some((value, index) => index % 4 === 3 && value < 250);
        if (!allowed) throw Error('Le blanc perlé nécessite un logo détouré sur fond transparent. Choisissez « Couleurs d’origine » pour ce fichier.');
        context.globalCompositeOperation = 'source-in'; context.fillStyle = '#f9fbf4';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    const crop = adaptive && setting.crop !== false ? analysis.crop! : {x: 0, y: 0, width: originalWidth, height: originalHeight};
    const cropped = crop.x !== 0 || crop.y !== 0 || crop.width !== originalWidth || crop.height !== originalHeight;
    if (adaptive && (cropped || setting.mode === 'monochrome' || backgroundStatus === 'removed')) {
      bitmap = await createImageBitmap(setting.mode === 'monochrome' || backgroundStatus === 'removed' ? canvas! : source, crop.x, crop.y, crop.width, crop.height); signal.throwIfAborted();
      source.close(); source = undefined; if (canvas) {canvas.width = canvas.height = 0; canvas = undefined;}
    } else if (setting.mode === 'monochrome') {
      source.close(); source = undefined;
    } else {
      bitmap = source; source = undefined; if (canvas) {canvas.width = canvas.height = 0; canvas = undefined;}
    }
    const image = bitmap ?? canvas!;
    let disposed = false;
    return {
      image, width: image.width, height: image.height, originalWidth, originalHeight, cropped,
      hasTransparency: analysis.hasTransparency, backgroundStatus, autoPlate: setting.mode === 'monochrome' ? 'black' : analysis.autoPlate,
      dispose() {if (disposed) return; disposed = true; bitmap?.close(); if (canvas) canvas.width = canvas.height = 0;},
    };
  } catch (error) {
    source?.close(); bitmap?.close(); if (canvas) canvas.width = canvas.height = 0; throw error;
  }
}

/** Geometry returned is the painted artwork; a support's padding stays separate. */
export function paintCommercialLogo(context: CanvasRenderingContext2D, asset: CommercialLogoAsset, setting: CommercialLogo, options: {alpha?: number; offsetX?: number} = {}): CommercialLogoBounds {
  const box = commercialLogoBounds(setting, asset.width, asset.height), pad = commercialLogoPadding(setting);
  const x = box.x + (options.offsetX ?? 0), y = box.y, left = x - box.width / 2, top = y - box.height / 2;
  const plate = setting.plate === 'auto' ? asset.autoPlate : setting.plate;
  const adaptive = setting.presentation === 'adaptive';
  context.save();
  context.globalAlpha *= (adaptive ? 1 : .92) * (setting.opacity ?? 1) * (options.alpha ?? 1);
  if (plate === 'showcase') {
    const light=asset.autoPlate==='white';
    // Keep opaque white/black file backgrounds seamless and preserve brand colours.
    context.fillStyle=light?'#ffffff':asset.hasTransparency?'#08271d':'#000000';
    context.beginPath();context.roundRect(left-pad,top-pad,box.width+pad*2,box.height+pad*2,20);context.fill();
    context.strokeStyle=light?'rgba(199,162,75,.6)':'rgba(225,217,180,.48)';context.lineWidth=1.5;context.stroke();
  } else if (plate && plate !== 'none') {
    context.fillStyle = {white: '#ffffff', black: adaptive ? '#000000' : '#07120e', gold: '#c7a24b', green: '#174d37'}[plate];
    context.beginPath(); context.roundRect(left - pad, top - pad, box.width + pad * 2, box.height + pad * 2, 10); context.fill();
  }
  context.drawImage(asset.image, left, top, box.width, box.height); context.restore();
  return {...box, x};
}
