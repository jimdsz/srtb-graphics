import { chromium, expect } from "@playwright/test";
import { Input, BufferSource, ALL_FORMATS } from "mediabunny";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";

await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "chrome",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1512, height: 1040 },
  acceptDownloads: true,
});
if (process.env.TEST_CSP) {
  const csp = (await readFile("public/_headers", "utf8"))
    .split("\n")
    .find((line) => line.includes("Content-Security-Policy:"))
    .split("Content-Security-Policy: ")[1]
    .trim();
  await page.route("**/*", async (route) => {
    if (!route.request().url().startsWith(process.env.TEST_URL))
      return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), "Content-Security-Policy": csp },
    });
  });
}
const failures = [],
  network = [],
  passed = [];
page.on("pageerror", (e) => failures.push(e.message));
page.on("request", (r) => network.push({ method: r.method(), url: r.url() }));
const snapshot = () => page.locator("canvas").evaluate((c) => c.toDataURL());
const jsonFile = (name, value) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});
const fixture = (fps = 30) => ({
  v: "5.12.2",
  w: 400,
  h: 400,
  fr: fps,
  ip: 0,
  op: 60,
  assets: [],
  layers: [
    {
      ty: 4,
      ind: 1,
      ip: 0,
      op: 60,
      st: 0,
      ks: {
        o: { a: 0, k: 100 },
        r: { a: 0, k: 0 },
        p: { a: 0, k: [0, 0] },
        a: { a: 0, k: [0, 0] },
        s: { a: 0, k: [100, 100] },
      },
      shapes: [
        {
          ty: "rc",
          p: { a: 0, k: [200, 200] },
          s: { a: 0, k: [200, 200] },
          r: { a: 0, k: 0 },
        },
        {
          ty: "fl",
          c: { a: 0, k: [1, 0, 0, 1], sid: "test-color" },
          o: { a: 0, k: 100 },
          r: 1,
        },
      ],
    },
  ],
  slots: { "test-color": { p: { a: 0, k: [1, 0, 0, 1] } } },
});

async function inspect(file) {
  await page.getByLabel("Fichier à inspecter").setInputFiles(file);
  await expect(
    page.getByRole("button", { name: "Lire", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
}
async function exportAndInspect(format, frames, fps) {
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await page
    .getByRole("button", {
      name: format === "mp4" ? "Export MP4 TV" : "WebM · fond noir",
      exact: true,
    })
    .click();
  const download = await downloadPromise;
  const filename = `test-results/workflow-${frames}-${fps}.${format}`;
  await download.saveAs(filename);
  const input = new Input({
    source: new BufferSource(await readFile(filename)),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  const stats = await track.computePacketStats();
  assert.equal(track.codedWidth, 1920);
  assert.equal(track.codedHeight, 1080);
  assert.equal(track.codec, format === "mp4" ? "avc" : "vp9");
  assert.equal(stats.packetCount, frames);
  assert(Math.abs(stats.averagePacketRate - fps) < 0.01);
  input.dispose();
}
try {
  await page.goto(process.env.TEST_URL ?? "http://127.0.0.1:5190/");
  await expect(
    page.getByRole("button", { name: "Lire", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page.getByRole("button", { name: "Lire", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Arrêter", exact: true }).click();
  await expect(page.getByLabel("Position dans l’animation")).toHaveValue("0");
  await page.getByRole("button", { name: "Recommencer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByLabel("Position dans l’animation").fill("95");
  await expect(page.getByLabel("Position dans l’animation")).toHaveValue("95");
  passed.push("play/pause/stop/restart/seek");

  const original = await snapshot();
  await page
    .getByLabel("Titre du programme", { exact: true })
    .fill("TEST LOCAL");
  assert((await snapshot()) !== original, "text edit must alter pixels");
  await page
    .getByRole("button", { name: "Restaurer Titre du programme", exact: true })
    .click();
  assert((await snapshot()) === original, "text reset restores pixels");
  passed.push("text edit/reset exact pixels");
  await page
    .getByRole("button", { name: "Panneau #eb1905", exact: true })
    .click();
  assert((await snapshot()) !== original, "color edit must alter pixels");
  await page
    .getByRole("button", { name: "Restaurer Panneau", exact: true })
    .click();
  assert((await snapshot()) === original, "color reset restores pixels");
  passed.push("color edit/reset exact pixels");

  const imageBase64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 400;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#00ccff";
    ctx.fillRect(0, 0, 800, 400);
    return c.toDataURL().split(",")[1];
  });
  await page
    .locator("#field-program-image")
    .setInputFiles({
      name: "local-test.png",
      mimeType: "image/png",
      buffer: Buffer.from(imageBase64, "base64"),
    });
  await expect(
    page.getByText("local-test.png", { exact: false }),
  ).toBeVisible();
  assert((await snapshot()) !== original, "image edit must alter pixels");
  const imagePixel = await page
    .locator("canvas")
    .evaluate((c) =>
      Array.from(c.getContext("2d").getImageData(1500, 350, 1, 1).data),
    );
  assert.deepEqual(
    imagePixel,
    [0, 204, 255, 255],
    "Slot contains the chosen pixels, not a missing-image placeholder",
  );
  await page
    .getByRole("button", { name: "Restaurer Image du programme", exact: true })
    .click();
  assert((await snapshot()) === original, "image reset restores pixels");
  passed.push("local image slot/reset exact pixels");
  for (const mime of ["image/jpeg", "image/webp"]) {
    const base64 = await page.evaluate((mime) => {
      const c = document.createElement("canvas");
      c.width = 500;
      c.height = 500;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#cc00ff";
      ctx.fillRect(0, 0, 500, 500);
      return c.toDataURL(mime).split(",")[1];
    }, mime);
    const name = `private.${mime.split("/")[1]}`;
    await page
      .locator("#field-program-image")
      .setInputFiles({
        name,
        mimeType: mime,
        buffer: Buffer.from(base64, "base64"),
      });
    await expect(page.getByText(name, { exact: false })).toBeVisible();
    assert((await snapshot()) !== original, "JPEG/WebP alters pixels");
    await page
      .getByRole("button", {
        name: "Restaurer Image du programme",
        exact: true,
      })
      .click();
  }
  passed.push("JPEG and WebP images");
  await page
    .locator("#field-program-image")
    .setInputFiles({
      name: "corrupt.png",
      mimeType: "image/png",
      buffer: Buffer.from("not a png"),
    });
  await expect(page.getByRole("alert")).toContainText("Image invalide");
  assert((await snapshot()) === original, "invalid image must preserve pixels");
  passed.push("invalid image preserves previous frame");

  let downloads = 0;
  const countDownload = () => downloads++;
  page.on("download", countDownload);
  await page
    .getByRole("button", { name: "Export MP4 TV", exact: true })
    .click();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Export annulé");
  assert.equal(downloads, 0);
  page.off("download", countDownload);
  passed.push("cancel without partial download");

  await inspect("public/templates/btv-popup.lottie");
  await expect(
    page.getByRole("heading", { name: "btv-popup.lottie", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("program-title", { exact: true })).toBeEnabled();
  await expect(page.getByText("Slots natifs disponibles")).toBeVisible();
  const nativeBefore = await snapshot();
  await page
    .getByLabel("program-title", { exact: true })
    .fill("ARCHIVE LOTTIE");
  assert(
    (await snapshot()) !== nativeBefore,
    "native archive text must alter pixels",
  );
  passed.push("native .lottie load and slot edit");

  await inspect(jsonFile("source-30.json", fixture()));
  await expect(
    page.getByRole("heading", { name: "source-30.json" }),
  ).toBeVisible();
  const size = await page
    .locator("canvas")
    .evaluate((c) => ({
      w: c.width,
      h: c.height,
      css: c.getBoundingClientRect().width / c.getBoundingClientRect().height,
    }));
  assert.equal(size.w, 400);
  assert.equal(size.h, 400);
  assert(Math.abs(size.css - 1) < 0.001);
  await exportAndInspect("mp4", 50, 25);
  passed.push("30fps square source -> letterboxed 1080p25");
  await page.getByLabel("Cadence d’export").selectOption("source");
  await exportAndInspect("mp4", 60, 30);
  passed.push("source FPS export and repeated encoding");
  await exportAndInspect("webm", 60, 30);
  passed.push("WebM VP9 black background");

  const noSlots = fixture();
  delete noSlots.slots;
  delete noSlots.layers[0].shapes[1].c.sid;
  await inspect({
    name: "no-slots.lottie",
    mimeType: "application/zip",
    buffer: Buffer.from(
      zipSync({
        "manifest.json": strToU8(
          JSON.stringify({ version: "2", animations: [{ id: "example" }] }),
        ),
        "a/example.json": strToU8(JSON.stringify(noSlots)),
      }),
    ),
  });
  await expect(
    page.getByText("Aucun champ éditable", { exact: true }),
  ).toBeVisible();
  passed.push("no-slot .lottie read-only");
  await page
    .getByLabel("Fichier à inspecter")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
  await expect(page.getByRole("alert")).toContainText("JSON invalide");
  await expect(
    page.getByRole("heading", { name: "no-slots.lottie" }),
  ).toBeVisible();
  passed.push("invalid JSON preserves current template");

  await page.getByRole("button", { name: /Pop-up BTV/ }).click();
  await expect(
    page.getByLabel("Titre du programme", { exact: true }),
  ).toBeEnabled();
  assert(
    (await snapshot()) === original,
    "Switching back must preserve fonts and original render",
  );
  passed.push("font fidelity after multiple template changes");
  await page.screenshot({
    path: "test-results/desktop-final.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/mobile-final.png",
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth + 1,
  );
  assert.equal(overflow, false);
  passed.push("mobile without horizontal overflow");
  assert.deepEqual(failures, []);
  assert.equal(
    network.filter((r) => !["GET", "HEAD"].includes(r.method)).length,
    0,
  );
  assert.equal(
    network.filter(
      (r) =>
        /^https?:/.test(r.url) &&
        !r.url.startsWith(process.env.TEST_URL ?? "http://127.0.0.1:5190/"),
    ).length,
    0,
  );
  passed.push(
    "zero upload / zero third-party requests / zero runtime exceptions",
  );
  await writeFile(
    "test-results/workflows.json",
    JSON.stringify({ passed, failures }, null, 2),
  );
  await writeFile(
    `test-results/workflows-${process.env.BROWSER_CHANNEL ?? "chrome"}-${process.env.TEST_CSP ? "production" : "dev"}.json`,
    JSON.stringify({ passed, failures }, null, 2),
  );
  console.log(JSON.stringify({ passed, failures }));
} catch (error) {
  console.log("Passed before failure:", passed);
  await page.screenshot({
    path: "test-results/workflow-failure.png",
    fullPage: true,
  });
  throw error;
} finally {
  await browser.close();
}
