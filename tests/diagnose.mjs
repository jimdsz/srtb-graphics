import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1000 } });
page.on("console", (m) => console.log("CONSOLE", m.type(), m.text()));
page.on("pageerror", (e) => console.log("ERROR", e.message));
page.on("requestfailed", (r) =>
  console.log("NETWORK", r.url(), r.failure()?.errorText),
);
try {
  await page.goto("http://127.0.0.1:5190/");
  await page
    .waitForFunction(() => !document.body.innerText.includes("Chargement…"), {
      timeout: 25000,
    })
    .catch(() => {});
  console.log("BODY", await page.locator("body").innerText());
  await page.screenshot({
    path: "test-results/diagnostic.png",
    fullPage: true,
  });
  console.log(
    "CANVAS",
    await page.locator("canvas").evaluate((c) => ({ w: c.width, h: c.height })),
  );
} finally {
  await browser.close();
}
