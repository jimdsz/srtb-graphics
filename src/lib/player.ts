import { DotLottie } from "@lottiefiles/dotlottie-web";
import wasmUrl from "@lottiefiles/dotlottie-web/dotlottie-player.wasm?url";
import type { AnimationInfo, DetectedSlot } from "../types/template";
import { fonts } from "../templates/fonts";

DotLottie.setWasmUrl(wasmUrl); // Bundled locally. Never silently fall back to a CDN.
let fontData: Promise<{ name: string; bytes: ArrayBuffer }[]> | undefined;
export async function prepareFonts(register = false) {
  fontData ??= (async () => {
    await DotLottie.preload();
    const loaded = await Promise.all(
      fonts.map(async (font) => {
        const response = await fetch(font.url);
        if (!response.ok)
          throw new Error(`Police indisponible : ${font.name}.`);
        const bytes = await response.arrayBuffer();
        await document.fonts.load(`16px "${font.family}"`);
        return { name: font.name, bytes };
      }),
    );
    await document.fonts.ready;
    return loaded;
  })().catch((error) => {
    fontData = undefined;
    throw error;
  });
  const loaded = await fontData;
  // The native font registry can be invalidated when a previous player is destroyed.
  // Re-register before loading each document, never while encoding its frames.
  if (register)
    for (const font of loaded)
      if (!(await DotLottie.registerFont(font.name, font.bytes)))
        throw new Error(`Police illisible : ${font.name}.`);
}
export async function createPlayer(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  data: Record<string, unknown> | ArrayBuffer,
  signal?: AbortSignal,
  animationId?: string,
) {
  await prepareFonts(true);
  signal?.throwIfAborted();
  const player = new DotLottie({
    canvas,
    data,
    animationId,
    autoplay: false,
    loop: false,
    assetResolver: () => null,
    renderConfig: {
      autoResize: false,
      devicePixelRatio: 1,
      freezeOnOffscreen: false,
      quality: 100,
    },
    layout: { fit: "contain", align: [0.5, 0.5] },
    useFrameInterpolation: true,
  });
  return new Promise<DotLottie>((resolve, reject) => {
    const timer = window.setTimeout(
      () => fail(new Error("Le chargement du template a dépassé 20 secondes.")),
      20_000,
    );
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      player.removeEventListener("load", loaded);
      player.removeEventListener("loadError", failed);
    };
    const fail = (error: Error) => {
      cleanup();
      player.destroy();
      reject(error);
    };
    const loaded = () => {
      cleanup();
      resolve(player);
    };
    const failed = () =>
      fail(new Error("Ce fichier Lottie est invalide ou non pris en charge."));
    const abort = () =>
      fail(new DOMException("Chargement annulé", "AbortError"));
    player.addEventListener("load", loaded);
    player.addEventListener("loadError", failed);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
export function slotsOf(player: DotLottie): DetectedSlot[] {
  const slots = player.getSlots();
  return player
    .getSlotIds()
    .map((id) => ({
      id,
      type: player.getSlotType(id) ?? "unknown",
      value: slots[id],
    }));
}
export function infoOf(
  player: DotLottie,
  source?: Record<string, unknown>,
): AnimationInfo {
  const size = player.animationSize();
  const frames = source
    ? Number(source.op) - Number(source.ip)
    : player.totalFrames;
  const fps = source ? Number(source.fr) : player.totalFrames / player.duration;
  if (
    ![size.width, size.height, frames, fps].every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error("Dimensions ou durée du template invalides.");
  return { ...size, fps, frames, duration: frames / fps };
}
export function textValue(value: unknown): string {
  const v = value as
    { t?: string; k?: { s?: { t?: string } }[]; p?: unknown } | undefined;
  return v?.t ?? v?.k?.[0]?.s?.t ?? (v?.p ? textValue(v.p) : "");
}
export function colorValue(value: unknown): string {
  const v = value as { k?: number[]; p?: unknown } | number[] | undefined;
  const c = Array.isArray(v)
    ? v
    : v && "p" in v
      ? undefined
      : (v as { k?: number[] })?.k;
  if (c?.length && c.slice(0, 3).every((n) => typeof n === "number"))
    return (
      "#" +
      c
        .slice(0, 3)
        .map((n) =>
          Math.round(Math.max(0, Math.min(1, n)) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  return v && !Array.isArray(v) && v.p ? colorValue(v.p) : "#007300";
}
export async function renderFrame(player: DotLottie, frame: number) {
  // In pinned 0.80.0 setFrame synchronously renders and draws the pixel buffer.
  // This microtask runs after _draw(), not on a real-time playback timer.
  player.setFrame(frame);
  await Promise.resolve();
  if (Math.abs(player.currentFrame - frame) > 0.06)
    throw new Error(`L’image ${frame.toFixed(2)} n’a pas été rendue.`);
}
