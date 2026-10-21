import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5191/");
  const result = await page.evaluate(
    async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.width = 960;
      video.height = 540;
      document.body.replaceChildren(video);
      const metadata = new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
      });
      video.src = url;
      await metadata;
      video.currentTime = 3.8;
      const presented = new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("No decoded frame presented by HTML video")),
          15000,
        );
        const check = (_now, info) => {
          if (info.mediaTime >= 3.8) {
            clearTimeout(timeout);
            resolve(info);
          } else video.requestVideoFrameCallback(check);
        };
        video.requestVideoFrameCallback(check);
      });
      await video.play();
      await presented;
      video.pause();
      const canvas = document.createElement("canvas");
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0);
      const p = ctx.getImageData(0, 0, 1920, 1080).data;
      let cyan = 0;
      for (let i = 0; i < p.length; i += 4)
        if (p[i] < 20 && p[i + 1] > 180 && p[i + 2] > 230) cyan++;
      const result = {
        time: video.currentTime,
        width: video.videoWidth,
        height: video.videoHeight,
        cyan,
      };
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      return result;
    },
    (await readFile("test-results/critical-path.mp4")).toString("base64"),
  );
  assert(
    result.cyan > 70000,
    "Native HTML video playback must display the exported local image",
  );
  console.log("Native HTML video playback:", result);
} finally {
  await browser.close();
}
