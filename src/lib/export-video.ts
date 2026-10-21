import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  WebMOutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeVideo,
} from "mediabunny";
import type { DotLottie } from "@lottiefiles/dotlottie-web";
import type { AnimationInfo } from "../types/template";
import { prepareFonts, renderFrame } from "./player";

export type VideoFormat = "mp4" | "webm";
export async function codecSupport(fps: number) {
  if (!window.isSecureContext || typeof VideoEncoder === "undefined")
    return { mp4: false, webm: false };
  const config = {
    width: 1920,
    height: 1080,
    frameRate: fps,
    quality: QUALITY_HIGH,
  };
  const [mp4, webm] = await Promise.all(
    ["avc", "vp9"].map((codec) =>
      canEncodeVideo(codec as "avc" | "vp9", config).catch(() => false),
    ),
  );
  return { mp4, webm };
}
export async function exportVideoFile(
  player: DotLottie,
  info: AnimationInfo,
  signal: AbortSignal,
  progress: (value: number) => void,
  fps = 25,
  format: VideoFormat = "mp4",
) {
  if (!(await codecSupport(fps))[format])
    throw new Error(
      `Encodage ${format === "mp4" ? "H.264" : "VP9"} indisponible. Essayez Chrome ou Edge récent, ou l’autre format proposé.`,
    );
  await prepareFonts();
  signal.throwIfAborted();
  const originalFrame = player.currentFrame;
  player.pause();
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx)
    throw new Error("Le navigateur ne peut pas créer le canevas vidéo.");
  const sourceCanvas = player.canvas as OffscreenCanvas;
  const target = new BufferTarget();
  const output = new Output({
    format: format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target,
  });
  const source = new CanvasSource(canvas, {
    codec: format === "mp4" ? "avc" : "vp9",
    quality: QUALITY_HIGH,
    alpha: "discard",
  });
  output.addVideoTrack(source, { frameRate: fps });
  const frames = Math.ceil(info.duration * fps - 1e-8);
  const scale = Math.min(1920 / info.width, 1080 / info.height);
  const width = info.width * scale,
    height = info.height * scale;
  try {
    await output.start();
    for (let i = 0; i < frames; i++) {
      signal.throwIfAborted();
      await renderFrame(
        player,
        Math.min(info.frames - 1, (i * info.fps) / fps),
      );
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 1920, 1080);
      ctx.drawImage(
        sourceCanvas,
        (1920 - width) / 2,
        (1080 - height) / 2,
        width,
        height,
      );
      await source.add(i / fps, 1 / fps);
      progress(Math.min(99, Math.round(((i + 1) / frames) * 99)));
      if (i % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    source.close();
    await output.finalize();
    signal.throwIfAborted();
    if (!target.buffer)
      throw new Error("Le fichier vidéo n’a pas pu être finalisé.");
    progress(100);
    return new Blob([target.buffer], {
      type: format === "mp4" ? "video/mp4" : "video/webm",
    });
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  } finally {
    source.close();
    player.setFrame(originalFrame);
    canvas.width = canvas.height = 0;
  }
}
