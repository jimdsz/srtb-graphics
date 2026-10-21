import { strFromU8, unzipSync } from "fflate";
import type { AnimationInfo, ParsedTemplate } from "../types/template";
import { fonts } from "../templates/fonts";

export const MAX_TEMPLATE_BYTES = 20 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
type Json = Record<string, any>; // Lottie is a heterogeneous document; validate at this boundary.

function parseJson(bytes: Uint8Array): Json {
  try {
    const value: unknown = JSON.parse(strFromU8(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as Json;
  } catch {
    throw new Error(
      "JSON invalide : le fichier ne contient pas un document lisible.",
    );
  }
}

function metadata(source: Json): AnimationInfo {
  const { w: width, h: height, fr: fps, ip, op } = source;
  if (
    ![width, height, fps, ip, op].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) ||
    !Array.isArray(source.layers)
  )
    throw new Error(
      "Ce JSON n’est pas une animation Lottie valide (dimensions, fr, ip, op ou layers manquants).",
    );
  const frames = op - ip;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > 8_847_360
  )
    throw new Error(
      "Dimensions non prises en charge : maximum 4096 px par côté et 8,8 millions de pixels.",
    );
  if (fps < 1 || fps > 120 || frames <= 0 || frames / fps > 120)
    throw new Error(
      "Pour ce MVP, utilisez une animation de 1 à 120 images/s et de 120 secondes maximum.",
    );
  return { width, height, fps, frames, duration: frames / fps };
}

export function parseTemplate(
  bytes: Uint8Array,
  filename: string,
): ParsedTemplate {
  if (!bytes.length || bytes.length > MAX_TEMPLATE_BYTES)
    throw new Error("Choisissez un template de moins de 20 Mo, non vide.");
  const format = filename.toLowerCase().endsWith(".lottie")
    ? "lottie"
    : filename.toLowerCase().endsWith(".json")
      ? "json"
      : undefined;
  if (!format) throw new Error("Format attendu : .json ou .lottie.");
  let source: Json,
    animationId: string | undefined,
    animationCount = 1;
  if (format === "lottie") {
    let unpacked = 0,
      count = 0;
    let archive: Record<string, Uint8Array>;
    try {
      archive = unzipSync(bytes, {
        filter: (entry) => {
          unpacked += entry.originalSize;
          count++;
          if (
            unpacked > MAX_UNPACKED_BYTES ||
            count > 512 ||
            !Number.isFinite(unpacked)
          )
            throw new Error("Archive trop volumineuse.");
          if (
            entry.name.startsWith("/") ||
            entry.name.includes("\\") ||
            entry.name.split("/").includes("..")
          )
            throw new Error("Chemin d’archive invalide.");
          return true;
        },
      });
    } catch {
      throw new Error(
        "Archive .lottie invalide ou trop volumineuse (64 Mo décompressés maximum).",
      );
    }
    if (!archive["manifest.json"])
      throw new Error("Archive .lottie sans manifest.json.");
    const manifest = parseJson(archive["manifest.json"]);
    animationId = manifest.animations?.[0]?.id;
    animationCount = manifest.animations?.length ?? 0;
    if (typeof animationId !== "string" || !/^[\w-]+$/.test(animationId))
      throw new Error(
        "Identifiant d’animation absent ou invalide dans le manifeste.",
      );
    const entry =
      archive[`a/${animationId}.json`] ??
      archive[`animations/${animationId}.json`];
    if (!entry)
      throw new Error("L’animation déclarée est absente de l’archive.");
    source = parseJson(entry);
    // Validate every animation, since native archive loading may parse the whole package.
    for (const [name, contents] of Object.entries(archive)) {
      if (/^(a|animations)\/.+\.json$/.test(name))
        validateAssets(parseJson(contents), archive);
    }
  } else {
    source = parseJson(bytes);
    validateAssets(source);
  }
  const info = metadata(source);
  const layers = [
    source.layers,
    ...(source.assets ?? []).map((a: Json) => a.layers ?? []),
  ].flat();
  return {
    format,
    source,
    info,
    animationId,
    animationCount,
    data: format === "lottie" ? Uint8Array.from(bytes).buffer : source,
    potentialFallback:
      format === "json" &&
      layers.some((layer: Json) => layer.ty === 5 || layer.ty === 2),
  };
}

function validateAssets(source: Json, archive?: Record<string, Uint8Array>) {
  metadata(source);
  if (source.assets !== undefined && !Array.isArray(source.assets))
    throw new Error("Liste des médias Lottie invalide.");
  const embedded = /^data:image\/(png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i;
  for (const asset of source.assets ?? []) {
    if (typeof asset.p !== "string") continue;
    if (embedded.test(asset.p)) continue;
    const path = `${asset.u ?? ""}${asset.p}`;
    const candidates = [
      path,
      path.replace(/^\.\.\//, ""),
      `i/${asset.p}`,
      `images/${asset.p}`,
    ];
    if (
      archive &&
      !/^[a-z]+:|^\//i.test(path) &&
      candidates.some((p) => archive[p])
    )
      continue;
    throw new Error(
      `Média manquant ou externe : ${asset.id ?? "image"}. Incorporez les PNG/JPEG/WebP au JSON ou à l’archive .lottie. Aucun média distant n’est chargé.`,
    );
  }
}

export function assertFontsAvailable(source: Json) {
  const known = new Set(fonts.map((f) => f.name));
  const required = new Set<string>();
  const layers = [
    source.layers,
    ...(source.assets ?? []).map((a: Json) => a.layers ?? []),
  ].flat();
  for (const layer of layers)
    if (layer.ty === 5)
      for (const key of layer.t?.d?.k ?? [])
        if (key.s?.f) required.add(key.s.f);
  for (const slot of Object.values(source.slots ?? {}) as Json[])
    if (Array.isArray(slot.p?.k))
      for (const key of slot.p.k) if (key.s?.f) required.add(key.s.f);
  const missing = [...required].filter((name) => !known.has(name));
  if (missing.length)
    throw new Error(
      `Police non préparée : ${missing.join(", ")}. Ajoutez la police originale dans public/fonts et src/templates/fonts.ts. Aucune substitution automatique.`,
    );
}

export async function loadOfficial(src: string, signal: AbortSignal) {
  const response = await fetch(src, { signal });
  if (!response.ok)
    throw new Error(
      "Template introuvable. Vérifiez les fichiers de la bibliothèque.",
    );
  if (Number(response.headers.get("content-length")) > MAX_TEMPLATE_BYTES)
    throw new Error("Template trop volumineux (20 Mo maximum).");
  return parseTemplate(new Uint8Array(await response.arrayBuffer()), src);
}
