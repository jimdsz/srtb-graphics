import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.route("http://127.0.0.1:5190/", (r) =>
  r.fulfill({
    body: "<html><body>Isolated core test</body></html>",
    contentType: "text/html",
  }),
);
await page.goto("http://127.0.0.1:5190/");
page.on("console", (m) => console.log(m.text()));
const data = JSON.parse(
  await readFile("public/templates/btv-popup.json", "utf8"),
);
const mode = process.argv[2] ?? "empty";
if (mode === "empty") data.layers = [];
if (mode === "no-slots") {
  delete data.slots;
  const clear = (o) => {
    if (!o || typeof o !== "object") return;
    delete o.sid;
    Object.values(o).forEach(clear);
  };
  clear(data);
}
const cdp = await context.newCDPSession(page);
await cdp.send("Debugger.enable");
const evaluation = page.evaluate(
  async ({ data, mode }) => {
    const { DotLottie } =
      await import("/node_modules/.vite/deps/@lottiefiles_dotlottie-web.js");
    DotLottie.setWasmUrl(
      "/node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm",
    );
    if (mode === "fonts" || mode === "ttf") {
      const ext = mode === "ttf" ? "ttf" : "otf";
      console.log(
        "FONT",
        await DotLottie.registerFont(
          "BeninSemiBold-Regular",
          `/fonts/BeninSemiBold-Regular.${ext}`,
        ),
      );
      console.log(
        "FONT",
        await DotLottie.registerFont("SuisseIntl", `/fonts/SuisseIntl.${ext}`),
      );
    }
    const player = new DotLottie({
      canvas: new OffscreenCanvas(1920, 1080),
      data,
      renderConfig: {
        autoResize: false,
        devicePixelRatio: 1,
        freezeOnOffscreen: false,
      },
    });
    player.addEventListener("ready", () => console.log("CORE READY"));
    return await new Promise((resolve) => {
      player.addEventListener("load", () => {
        console.log("CORE LOADED");
        player.setFrame(95);
        console.log("FRAME RENDERED");
        resolve({
          loaded: player.isLoaded,
          slots: player.getSlots(),
          size: player.animationSize(),
        });
        player.destroy();
      });
      player.addEventListener("loadError", (e) =>
        resolve({ error: String(e.error) }),
      );
    });
  },
  { data, mode },
);
try {
  console.log(
    mode,
    await Promise.race([
      evaluation,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("core timed out")), 8000),
      ),
    ]),
  );
} catch (e) {
  console.log(e.message);
  const pause = cdp.waitForEvent
    ? null
    : new Promise((resolve) => cdp.once("Debugger.paused", resolve));
  await cdp.send("Debugger.pause");
  if (pause) {
    const p = await pause;
    console.log(
      p.callFrames
        .slice(0, 10)
        .map((f) => ({ function: f.functionName, url: f.url })),
    );
  }
} finally {
  await browser.close();
}
