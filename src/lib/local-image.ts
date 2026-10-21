export async function prepareLocalImage(
  file: File,
  width?: number,
  height?: number,
): Promise<Blob> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size === 0 ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error(
      "Choisissez une image PNG, JPEG ou WebP de moins de 20 Mo.",
    );
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Image invalide ou illisible. Choisissez un autre fichier.",
    );
  }
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error("Image trop grande : 40 millions de pixels maximum.");
    const w = width ?? Math.min(bitmap.width, 1920);
    const h = height ?? Math.round((bitmap.height * w) / bitmap.width);
    if (w < 1 || h < 1 || w > 4096 || h > 4096)
      throw new Error("Dimensions du slot image non prises en charge.");
    const canvas = new OffscreenCanvas(w, h),
      ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Préparation de l’image indisponible.");
    // Fill the slot without stretching. Centre-crop is explicit in the UI.
    const scale = Math.max(w / bitmap.width, h / bitmap.height);
    ctx.drawImage(
      bitmap,
      (w - bitmap.width * scale) / 2,
      (h - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
    return await canvas.convertToBlob({ type: "image/png" });
  } finally {
    bitmap.close();
  }
}

export function imageSlotSource(
  blob: Blob,
  signal: AbortSignal,
): Promise<string> {
  // dotLottie 0.80.0 converts HTTP sources, but passes blob: URLs verbatim to
  // the native core, which cannot resolve them. A local data URI is required.
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const reader = new FileReader();
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => reader.abort();
    reader.onload = () => {
      cleanup();
      resolve(String(reader.result));
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("Impossible de préparer l’image locale."));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException("Lecture annulée", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(blob);
  });
}
