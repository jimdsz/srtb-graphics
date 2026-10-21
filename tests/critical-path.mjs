import { chromium } from "@playwright/test";
import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1512, height: 1000 },
  acceptDownloads: true,
});
const errors = [],
  requests = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => console.log("Browser:", m.text()));
page.on("request", (r) => requests.push({ method: r.method(), url: r.url() }));
try {
  await page.goto("http://127.0.0.1:5190/");
  await page
    .getByLabel("Titre du programme", { exact: true })
    .waitFor({ timeout: 30000 });
  const before = await page.locator("canvas").evaluate((c) => c.toDataURL());
  await page
    .getByLabel("Titre du programme", { exact: true })
    .fill("LE RENDEZ-VOUS\nDE LA CULTURE");
  const after = await page.locator("canvas").evaluate((c) => c.toDataURL());
  assert(before !== after, "Text edit must really change canvas pixels");
  const dimensions = await page
    .locator("canvas")
    .evaluate((c) => ({ width: c.width, height: c.height }));
  assert.deepEqual(dimensions, { width: 1920, height: 1080 });
  const photo = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 392;
    c.height = 220;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#00ccff";
    ctx.fillRect(0, 0, 392, 220);
    return c.toDataURL().split(",")[1];
  });
  await page
    .locator("#field-program-image")
    .setInputFiles({
      name: "private-test.png",
      mimeType: "image/png",
      buffer: Buffer.from(photo, "base64"),
    });
  await page.getByText("private-test.png", { exact: false }).waitFor();
  await page.screenshot({
    path: "test-results/critical-preview.png",
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download", { timeout: 180000 });
  await page
    .getByRole("button", { name: "Export MP4 TV", exact: true })
    .click();
  const download = await downloadPromise;
  const outputPath = "test-results/critical-path.mp4";
  await download.saveAs(outputPath);
  const bytes = await readFile(outputPath);
  const input = new Input({
    source: new BufferSource(bytes),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  assert(track);
  assert.equal(track.codec, "avc");
  assert.equal(track.codedWidth, 1920);
  assert.equal(track.codedHeight, 1080);
  const stats = await track.computePacketStats();
  assert.equal(stats.packetCount, 301);
  assert(Math.abs(stats.averagePacketRate - 25) < 0.01);
  const duration = await input.computeDuration();
  assert(Math.abs(duration - 12.04) < 0.001);
  // Actually decode the downloaded MP4, not just its metadata.
  const decoded = await page.evaluate(async (base64) => {
    const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([data], { type: "video/mp4" }));
    const video = document.createElement("video");
    video.muted = true;
    video.src = url;
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = reject;
    });
    await new Promise((resolve, reject) => {
      video.onseeked = resolve;
      video.onerror = reject;
      video.currentTime = 3.8;
    });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    const moduleUrl = performance
      .getEntriesByType("resource")
      .map((e) => e.name)
      .find((url) => /\/mediabunny\.js\?/.test(url));
    const { Input, BufferSource, ALL_FORMATS, CanvasSink } = await import(
      moduleUrl ?? "/node_modules/.vite/deps/mediabunny.js"
    );
    const decodedInput = new Input({
      source: new BufferSource(data),
      formats: ALL_FORMATS,
    });
    const decodedTrack = await decodedInput.getPrimaryVideoTrack();
    const sink = new CanvasSink(decodedTrack);
    const decodedFrame = await sink.getCanvas(3.8);
    ctx.drawImage(decodedFrame.canvas, 0, 0);
    decodedInput.dispose();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonBlack = 0,
      cyan = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 70) nonBlack++;
      if (pixels[i] < 20 && pixels[i + 1] > 180 && pixels[i + 2] > 230) cyan++;
    }
    const result = {
      width: video.videoWidth,
      height: video.videoHeight,
      nonBlack,
      cyan,
      image: canvas.toDataURL(),
    };
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
    return result;
  }, bytes.toString("base64"));
  await writeFile(
    "test-results/decoded-mp4.png",
    Buffer.from(decoded.image.split(",")[1], "base64"),
  );
  console.log("Decoded nonblack pixels:", decoded.nonBlack);
  assert(
    decoded.nonBlack > 20000,
    "Decoded MP4 must contain the rendered graphics",
  );
  assert(
    decoded.cyan > 70000,
    "Decoded MP4 must contain the locally selected image",
  );
  delete decoded.image;
  assert.equal(
    requests.filter((r) => !["GET", "HEAD"].includes(r.method)).length,
    0,
    "No upload",
  );
  assert.deepEqual(errors, []);
  const report = {
    ok: true,
    dimensions,
    codec: track.codec,
    duration,
    ...stats,
    decoded,
    bytes: bytes.length,
    runtimeErrors: errors,
    nonReadRequests: [],
  };
  await writeFile(
    "test-results/critical-path.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  input.dispose();
} finally {
  await browser.close();
}
