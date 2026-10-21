/** Conservative, deterministic removal of a solid, border-connected matte. */
export type CommercialLogoBackgroundStatus = 'removed' | 'transparent' | 'complex';
export type CommercialLogoBackgroundReason =
  | 'existing-alpha' | 'non-uniform-border' | 'insufficient-contrast'
  | 'empty-artwork' | 'insufficient-background' | 'image-too-large' | 'solid-border';
export interface CommercialLogoBackgroundResult {
  /** Always a new buffer; dimensions and the original input are unchanged. */
  pixels: Uint8ClampedArray;
  status: CommercialLogoBackgroundStatus;
  background: [number, number, number] | null;
  /** Evidence for a uniform border, not an estimate of semantic segmentation quality. */
  confidence: number;
  removedPixels: number;
  featheredPixels: number;
  tolerance: number;
  reason: CommercialLogoBackgroundReason;
}

/**
 * An opaque image is eligible only when all four sides agree on one matte.
 * Flood fill never crosses foreground to remove an enclosed white/coloured area.
 * An existing alpha channel is authoritative and is returned byte-for-byte.
 *
 * This is intentionally not a general photo cut-out. Ambiguous images retain
 * their source pixels, including low-contrast marks and blank solid rectangles.
 */
export function removeCommercialLogoBackground(
  pixels: Uint8ClampedArray, width: number, height: number,
): CommercialLogoBackgroundResult {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
      || !Number.isSafeInteger(count * 4) || pixels.length !== count * 4) {
    throw new RangeError('Les dimensions du logo sont invalides.');
  }
  const unchanged = (reason: CommercialLogoBackgroundReason,
    background: [number, number, number] | null = null, confidence = 0, tolerance = 0,
    status: CommercialLogoBackgroundStatus = 'complex'): CommercialLogoBackgroundResult =>
    ({pixels: pixels.slice(), status, background, confidence, removedPixels: 0, featheredPixels: 0, tolerance, reason});
  for (let at = 3; at < pixels.length; at += 4) {
    if (pixels[at] !== 255) return unchanged('existing-alpha', null, 1, 0, 'transparent');
  }
  // A caller can downsample an oversized import before analysis. Avoid allocating
  // an unbounded flood-fill queue on top of an already decoded browser image.
  if (count > 16_777_216 || width > 32_768 || height > 32_768) return unchanged('image-too-large');
  if (width < 3 || height < 3) return unchanged('insufficient-background');

  const sides: number[][] = [[], [], [], []];
  for (let x = 0; x < width; x++) {sides[0].push(x); sides[1].push((height - 1) * width + x);}
  for (let y = 0; y < height; y++) {sides[2].push(y * width); sides[3].push(y * width + width - 1);}
  const border = [...new Set(sides.flat())];
  const median = (values: number[]) => {
    values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)];
  };
  const background: [number, number, number] = [0, 1, 2].map(channel =>
    median(border.map(index => pixels[index * 4 + channel]))) as [number, number, number];
  const distance = (index: number) => Math.max(
    Math.abs(pixels[index * 4] - background[0]),
    Math.abs(pixels[index * 4 + 1] - background[1]),
    Math.abs(pixels[index * 4 + 2] - background[2]),
  );
  const deviations = border.map(distance).sort((a, b) => a - b);
  const noise = deviations[Math.floor((deviations.length - 1) * .95)];
  // 12/255 at the border tolerates mild JPEG noise, but not a gradient/photo.
  const agreement = border.filter(index => distance(index) <= 12).length / border.length;
  if (noise > 12 || agreement < .97
      || sides.some(side => side.filter(index => distance(index) <= 12).length / side.length < .94)
      || [0, width - 1, count - width, count - 1].some(index => distance(index) > 12)) {
    return unchanged('non-uniform-border', background, agreement);
  }
  const tolerance = Math.min(16, Math.max(14, noise + 4));
  let strongPixels = 0, maxContrast = 0;
  for (let index = 0; index < count; index++) {
    const contrast = distance(index); maxContrast = Math.max(maxContrast, contrast);
    if (contrast >= 48) strongPixels++;
  }
  if (maxContrast < 48 || strongPixels < Math.max(4, Math.ceil(count * .0001))) {
    return unchanged('insufficient-contrast', background, agreement, tolerance);
  }

  const mask = new Uint8Array(count), queue = new Int32Array(count);
  let head = 0, tail = 0;
  const visit = (index: number) => {
    const at = index * 4, r = pixels[at] - background[0],
      g = pixels[at + 1] - background[1], b = pixels[at + 2] - background[2];
    // JPEG's chroma subsampling leaves pale tinted specks beside sharp marks.
    // Perceptual weighting removes those without raising the neutral (grey)
    // threshold; an additional channel cap prevents a saturated tint passing.
    if (!mask[index] && Math.max(Math.abs(r), Math.abs(g), Math.abs(b)) <= Math.min(30, tolerance * 2.5)
        && .2126 * r * r + .7152 * g * g + .0722 * b * b <= tolerance * tolerance) {
      mask[index] = 1; queue[tail++] = index;
    }
  };
  for (const index of border) visit(index);
  while (head < tail) {
    const index = queue[head++], x = index % width;
    if (x) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < count - width) visit(index + width);
  }
  if (tail < Math.max(4, count * .02)) return unchanged('insufficient-background', background, agreement, tolerance);
  if (count - tail < Math.max(4, Math.ceil(count * .0002))) return unchanged('empty-artwork', background, agreement, tolerance);

  const result = pixels.slice();
  for (let i = 0; i < tail; i++) result[queue[i] * 4 + 3] = 0;
  let featheredPixels = 0, additionallyRemoved = 0;
  const stableColour = (index: number) => {
    const x = index % width, y = Math.floor(index / width), at = index * 4;
    let matches = 0;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const other = ny * width + nx;
      if (!mask[other] && Math.max(...[0, 1, 2].map(c =>
        Math.abs(pixels[other * 4 + c] - pixels[at + c]))) <= Math.max(5, noise + 2)) matches++;
    }
    return matches >= 2;
  };
  // Only the immediate exterior boundary can be unmatted. An interior pixel,
  // even if white like the original background, never enters this pass.
  for (let index = 0; index < count; index++) {
    if (mask[index]) continue;
    const x = index % width, y = Math.floor(index / width);
    const touchesMatte = (x > 0 && mask[index - 1]) || (x + 1 < width && mask[index + 1])
      || (y > 0 && mask[index - width]) || (y + 1 < height && mask[index + width]);
    if (!touchesMatte) continue;
    const at = index * 4, delta = [0, 1, 2].map(c => pixels[at + c] - background[c]);
    let best: {index: number; alpha: number; error: number; spatial: number} | undefined;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const spatial = dx * dx + dy * dy;
      if (!spatial || spatial > 9) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const other = ny * width + nx;
      if (mask[other] || distance(other) < Math.max(48, distance(index) + 12) || !stableColour(other)) continue;
      const foreground = [0, 1, 2].map(c => pixels[other * 4 + c] - background[c]);
      const denominator = foreground.reduce((sum, value) => sum + value * value, 0);
      const alpha = delta.reduce((sum, value, c) => sum + value * foreground[c], 0) / denominator;
      if (alpha < 0 || alpha >= .94) continue;
      const error = Math.max(...delta.map((value, c) => Math.abs(value - alpha * foreground[c])));
      // Require the edge to agree with a real matte/foreground mixture. This
      // avoids recolouring a differently coloured outline or adjacent artwork.
      // Chroma subsampling can perturb a pale JPEG edge by several channel
      // levels even when its distant border is perfectly uniform.
      if (error > Math.min(10, Math.max(8, noise + 1))) continue;
      if (!best || error + spatial * .2 < best.error + best.spatial * .2) best = {index: other, alpha, error, spatial};
    }
    if (!best) continue;
    for (let channel = 0; channel < 3; channel++) result[at + channel] = pixels[best.index * 4 + channel];
    result[at + 3] = best.alpha < .06 ? 0 : Math.round(best.alpha * 255); featheredPixels++;
    if (!result[at + 3]) additionallyRemoved++;
  }
  return {
    pixels: result, status: 'removed', background, confidence: agreement,
    removedPixels: tail + additionallyRemoved, featheredPixels, tolerance, reason: 'solid-border',
  };
}
