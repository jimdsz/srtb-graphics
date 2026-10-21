import { chromium, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const passed = [];
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window, "VideoEncoder", {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto("http://127.0.0.1:5191/");
  await expect(page.getByText(/H.264 indisponible/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export MP4 TV" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Lire", exact: true }),
  ).toBeEnabled();
  passed.push("unsupported encoder explained without disabling preview");
  await page.close();
  const missing = await browser.newPage();
  await missing.route("**/templates/btv-popup.json", (route) =>
    route.fulfill({ status: 404, body: "Missing" }),
  );
  await missing.goto("http://127.0.0.1:5191/");
  await expect(missing.getByRole("alert")).toContainText(
    "Template introuvable",
  );
  await expect(
    missing.getByRole("button", { name: "Inspecter un template" }),
  ).toBeEnabled();
  passed.push("404 keeps recovery/import available");
  await missing.close();
  const font = await browser.newPage();
  await font.goto("http://127.0.0.1:5191/");
  const original = JSON.parse(
    await readFile("public/templates/btv-popup.json", "utf8"),
  );
  for (const layer of original.layers)
    if (layer.ty === 5) layer.t.d.k[0].s.f = "UnknownOriginalFont";
  await font
    .getByLabel("Fichier à inspecter")
    .setInputFiles({
      name: "missing-font.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(original)),
    });
  await expect(font.getByRole("alert")).toContainText("Police non préparée");
  await expect(
    font.getByRole("button", { name: "Export MP4 TV" }),
  ).toBeDisabled();
  await expect(
    font.getByRole("region", { name: "Inspection du template" }),
  ).toBeVisible();
  passed.push("missing proprietary font blocks export, retains metadata");
  await font.close();
  console.log({ passed });
  await writeFile(
    "test-results/errors.json",
    JSON.stringify({ passed }, null, 2),
  );
} finally {
  await browser.close();
}
