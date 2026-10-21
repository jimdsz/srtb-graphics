import type {CommercialLogo} from './model';

export interface CommercialLogoSize {
  /** Dimensions of the actual bitmap painted, after transparent-margin cropping. */
  width: number; height: number;
  originalWidth?: number; originalHeight?: number; cropped?: boolean;
  hasTransparency?: boolean;
  backgroundStatus?: 'removed' | 'transparent' | 'complex' | 'disabled';
}
export interface CommercialLogoBounds { x: number; y: number; width: number; height: number }

/** Shared visible baseline; the optional 24px logo support stays inside y984. */
export const COMMERCIAL_FOOTER_BASELINE = 960;
export const commercialLogoAutoAligned = (logo: CommercialLogo): boolean =>
  logo.presentation === 'adaptive' && logo.position !== 'top-right' && logo.alignment !== 'free';
const positions: CommercialLogo['position'][] = ['bottom-right', 'bottom-center', 'top-right'];
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));
const legacyAnchor = (position: CommercialLogo['position']) => ({x: position === 'bottom-center' ? 960 : 1704, y: position === 'top-right' ? 136 : 944});

export function commercialLogoPadding(logo: CommercialLogo): number {
  return logo.plate && logo.plate !== 'none' ? logo.presentation === 'adaptive' ? 24 : 12 : 0;
}

/** The optical area prevents a square mark from dwarfing a wordmark. */
export function commercialLogoDimensions(logo: CommercialLogo, width: number, height: number): CommercialLogoSize {
  const aspect = width / height;
  // A tall mark needs more height to keep its narrow artwork recognizable.
  // Landscape marks retain their original optical area; compact marks receive
  // a gradual increase, without stretching or changing the advertiser's image.
  const heightLimit = aspect < .8 ? Math.min(180, Math.max(144, Math.sqrt(16000 / aspect)))
    : aspect < 1 ? 144 - (aspect - .8) * 120 : Math.max(96, 120 - (aspect - 1) * 48);
  const opticalArea = aspect <= 1 ? 16000 : 16000 - Math.min(1, (aspect - 1) * 2) * 4000;
  const adaptiveFactor = aspect < .8 ? heightLimit / height : Math.min(Math.sqrt(opticalArea / (width * height)), 240 / width, heightLimit / height);
  const factor = (logo.presentation === 'adaptive' ? adaptiveFactor : Math.min(240 / width, 80 / height)) * logo.scale;
  return {width: width * factor, height: height * factor};
}

function anchor(logo: CommercialLogo, size: CommercialLogoSize, position = logo.position) {
  if (logo.presentation !== 'adaptive') return legacyAnchor(position);
  const dimensions = commercialLogoDimensions(logo, size.width, size.height), pad = commercialLogoPadding(logo);
  return {
    x: position === 'bottom-center' ? 960 : 1824 - pad - dimensions.width / 2,
    y: position === 'top-right' ? 96 + pad + dimensions.height / 2 : COMMERCIAL_FOOTER_BASELINE - dimensions.height / 2,
  };
}

/** Legacy projects retain their original frame and quadrant geometry. */
export function commercialLogoBounds(logo: CommercialLogo, width: number, height: number): CommercialLogoBounds {
  const dimensions = commercialLogoDimensions(logo, width, height),
    w = dimensions.width, h = dimensions.height, pad = commercialLogoPadding(logo), origin = anchor(logo, {width, height});
  let x = origin.x + (logo.offsetX ?? 0), y = origin.y + (commercialLogoAutoAligned(logo) ? 0 : logo.offsetY ?? 0);
  x = Math.max(96 + pad + w / 2, Math.min(1824 - pad - w / 2, x));
  y = Math.max(96 + pad + h / 2, Math.min(984 - pad - h / 2, y));
  if (x - w / 2 - pad < 960 && y - h / 2 - pad < 540) {
    const inset = logo.presentation === 'adaptive' ? 1e-9 : 0;
    x = Math.min(1824 - pad - w / 2, 960 + pad + w / 2 + inset);
    if (x - w / 2 - pad < 960 - inset) y = 540 + pad + h / 2;
  }
  return {x, y, width: w, height: h};
}

function checkSize(size: CommercialLogoSize): void {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    throw new RangeError('Les dimensions du logo doivent être positives et finies.');
  }
}

function offsetsAt(logo: CommercialLogo, size: CommercialLogoSize, position: CommercialLogo['position'], point: {x: number; y: number}) {
  const origin = anchor(logo, size, position);
  const stableLimit = (value: number, limit: number) => Math.abs(Math.abs(value) - limit) < 1e-7 ? Math.sign(value) * limit : value;
  return {offsetX: stableLimit(point.x - origin.x, 600), offsetY: stableLimit(point.y - origin.y, 400)};
}

function representable(logo: CommercialLogo, size: CommercialLogoSize, position: CommercialLogo['position'], point: {x: number; y: number}) {
  const offsets = offsetsAt(logo, size, position, point);
  return Math.abs(offsets.offsetX) <= 600 && Math.abs(offsets.offsetY) <= 400;
}

/** Remove latent, clamped offsets without moving or cropping the saved image. */
export function canonicalCommercialLogo(logo: CommercialLogo, size: CommercialLogoSize): CommercialLogo {
  checkSize(size);
  const point = commercialLogoBounds(logo, size.width, size.height);
  // A very wide top-right logo can be forced below the reserved quadrant by
  // the old renderer. Only this unrepresentable case needs another anchor.
  const position = representable(logo, size, logo.position, point) ? logo.position : positions.find(value => representable(logo, size, value, point));
  // For an exceptionally thin, wide image, the old clamp can yield y in
  // (536, 544): the eight-pixel gap between the anchors' stored ranges. Keep
  // the closest legacy preimage, which renders identically, until an edit.
  // editCommercialLogo starts from the rendered point even in this case.
  if (!position) {
    const offsets = offsetsAt(logo, size, logo.position, point);
    return {...logo, offsetX: clamp(offsets.offsetX, -600, 600), offsetY: clamp(offsets.offsetY, -400, 400)};
  }
  // A top-right image may need a bottom anchor to represent the same safe
  // coordinates. Reanchoring must not silently opt it into footer alignment.
  const free = logo.presentation === 'adaptive' && !commercialLogoAutoAligned(logo) && position !== 'top-right';
  return {...logo, position, ...(free ? {alignment:'free' as const} : {}), ...offsetsAt(logo, size, position, point)};
}

interface Rectangle { left: number; right: number; top: number; bottom: number }
interface ProjectedPoint { x: number; y: number; distance: number; position: CommercialLogo['position'] }

function project(logo: CommercialLogo, size: CommercialLogoSize, wanted: {x: number; y: number}, position: CommercialLogo['position']): ProjectedPoint | undefined {
  const dimensions = commercialLogoDimensions(logo, size.width, size.height),
    halfWidth = dimensions.width / 2, halfHeight = dimensions.height / 2,
    pad = commercialLogoPadding(logo), origin = anchor(logo, size, position);
  const frame: Rectangle = {
    left: Math.max(96 + pad + halfWidth, origin.x - 600),
    right: Math.min(1824 - pad - halfWidth, origin.x + 600),
    top: Math.max(96 + pad + halfHeight, origin.y - 400),
    bottom: Math.min(984 - pad - halfHeight, origin.y + 400),
  };
  // Keep the artwork's lower edge fixed, including when the source, support or
  // size changes. Only horizontal projection may resolve the reserved quadrant.
  if (commercialLogoAutoAligned(logo)) {
    frame.top = frame.bottom = COMMERCIAL_FOOTER_BASELINE - halfHeight;
  }
  // A tiny inward margin prevents floating-point subtraction in the legacy
  // renderer from mistaking a boundary point for the forbidden quadrant.
  const inset = 1e-9;
  const inward = (minimum: number, maximum: number) => minimum <= maximum ? Math.min(minimum + inset, maximum) : minimum;
  const regions: Rectangle[] = [
    {...frame, top: Math.max(frame.top, inward(540 + pad + halfHeight, frame.bottom))},
    {...frame, left: Math.max(frame.left, inward(960 + pad + halfWidth, frame.right))},
  ];
  let best: ProjectedPoint | undefined;
  for (const region of regions) {
    if (region.left > region.right || region.top > region.bottom) continue;
    const x = clamp(wanted.x, region.left, region.right), y = clamp(wanted.y, region.top, region.bottom);
    const distance = (x - wanted.x) ** 2 + (y - wanted.y) ** 2;
    // Equal distances favor the bottom region, avoiding an unnecessary
    // horizontal jump as a logo approaches the reserved upper-left area.
    if (!best || distance < best.distance) best = {x, y, distance, position};
  }
  return best;
}

/** Apply an edit to visible coordinates, then store only its attainable result. */
export function editCommercialLogo(logo: CommercialLogo, patch: Partial<CommercialLogo>, size: CommercialLogoSize): CommercialLogo {
  const current = canonicalCommercialLogo(logo, size), next = {...current, ...patch};
  next.scale = clamp(Number.isFinite(next.scale) ? next.scale : current.scale, .25, 4);
  next.offsetX = clamp(Number.isFinite(next.offsetX) ? next.offsetX! : current.offsetX!, -600, 600);
  next.offsetY = clamp(Number.isFinite(next.offsetY) ? next.offsetY! : current.offsetY!, -400, 400);
  if (next.presentation === 'adaptive' && next.position === 'top-right') {
    // Keep this explicit placement in the right-hand area, including when a
    // support is added. Store the attainable scale so the control stays honest.
    const unit = commercialLogoDimensions({...next, scale: 1}, size.width, size.height), pad = commercialLogoPadding(next);
    next.scale = Math.min(next.scale, (864 - 2 * pad) / unit.width, (888 - 2 * pad) / unit.height);
  }
  const origin = anchor(next, size), actual = commercialLogoBounds(current, size.width, size.height);
  const wanted = commercialLogoAutoAligned(next)
    ? {x: origin.x + next.offsetX, y: origin.y}
    : next.presentation === 'adaptive' && next.position === 'top-right' && Object.hasOwn(patch, 'scale')
    ? {x: origin.x + next.offsetX, y: origin.y + next.offsetY}
    : next.position === current.position
    ? {
      x: Object.hasOwn(patch, 'offsetX') ? origin.x + next.offsetX : actual.x,
      y: Object.hasOwn(patch, 'offsetY') ? origin.y + next.offsetY : actual.y,
    }
    : {x: origin.x + next.offsetX, y: origin.y + next.offsetY};
  let point = project(next, size, wanted, next.position);
  if (!point) {
    for (const position of positions) {
      const candidate = project(next, size, wanted, position);
      if (candidate && (!point || candidate.distance < point.distance)) point = candidate;
    }
  }
  if (!point) throw new RangeError('Le logo ne tient pas dans les zones autorisées.');
  const free = next.presentation === 'adaptive' && !commercialLogoAutoAligned(next) && point.position !== 'top-right';
  return {...next, position: point.position, ...(free ? {alignment:'free' as const} : {}), ...offsetsAt(next, size, point.position, point)};
}

/** Preview, editor and export must fit the same decoded/cropped bitmap. */
export function fitCommercialLogoToAsset(logo: CommercialLogo, size: CommercialLogoSize): CommercialLogo {
  if (logo.presentation !== 'adaptive' || logo.position !== 'top-right') return logo;
  return editCommercialLogo(logo, {position:'top-right',scale:logo.scale,offsetX:logo.offsetX??0,offsetY:logo.offsetY??0}, size);
}
