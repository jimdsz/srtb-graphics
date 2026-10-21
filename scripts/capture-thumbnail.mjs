// Capture the actual prepared template, not an illustrative mockup.
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:5190/");
  await page
    .getByLabel("Titre du programme", { exact: true })
    .waitFor({ timeout: 30000 });
  const data = await page.locator("canvas").evaluate((canvas) => {
    const thumb = document.createElement("canvas");
    thumb.width = 480;
    thumb.height = 270;
    thumb.getContext("2d").drawImage(canvas, 0, 0, 480, 270);
    return thumb.toDataURL();
  });
  await writeFile(
    "public/thumbnails/btv-popup.png",
    Buffer.from(data.split(",")[1], "base64"),
  );
} finally {
  await browser.close();
}
