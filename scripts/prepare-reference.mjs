// One-time, explicit preparation of a COPY of the existing BTV source.
// Nothing in the broadcast library is modified.
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
const source = path.resolve(
  "../BroadcastTemplates/DELIVERABLES/BTV_HABILLAGE_DYNAMIQUE_v1.7.0/templates/BTV_PopUp",
);
const data = JSON.parse(
  await readFile(path.join(source, "lib/lottie-template.json"), "utf8"),
);
data.nm = "BTV · Pop-up — SRTB Graphics";
data.slots = {};
const slotNames = {
  _title: "program-title",
  _label: "announcement",
  _subtitle: "subtitle",
};
const colors = {
  FOND: ["panel-color", [0, 115 / 255, 0, 1]],
  "VOLET VERT": ["shutter-green", [0, 115 / 255, 0, 1]],
  "VOLET ROUGE": ["shutter-red", [235 / 255, 25 / 255, 5 / 255, 1]],
};
for (const layers of [data.layers, ...data.assets.map((a) => a.layers ?? [])]) {
  for (const layer of layers) {
    const textSlot = slotNames[layer.nm];
    if (layer.ty === 5 && textSlot) {
      data.slots[textSlot] = { p: structuredClone(layer.t.d) };
      layer.t.d.sid = textSlot;
    }
    // AE Fill on solids is expressed as an equivalent native shape fill.
    // Retain original transforms, masks, ordering, timing and text animators.
    if (layer.ty === 1 && colors[layer.nm]) {
      const [slot, color] = colors[layer.nm];
      data.slots[slot] = { p: { a: 0, k: color } };
      layer.ty = 4;
      layer.shapes = [
        {
          ty: "rc",
          d: 1,
          p: { a: 0, k: [layer.sw / 2, layer.sh / 2] },
          s: { a: 0, k: [layer.sw, layer.sh] },
          r: { a: 0, k: 0 },
          nm: "Rectangle",
        },
        {
          ty: "fl",
          c: { a: 0, k: color, sid: slot },
          o: { a: 0, k: 100 },
          r: 1,
          nm: "Couleur de charte",
        },
      ];
      delete layer.ef;
      delete layer.sw;
      delete layer.sh;
      delete layer.sc;
    }
  }
}
// Restore the image window already present in the broadcast HTML wrapper,
// inside the existing animated/matted Rush precomposition. No new motion.
const imageAsset = {
  id: "program-photo",
  w: 392,
  h: 220,
  u: "",
  p:
    "data:image/png;base64," +
    (await readFile(path.join(source, "lib/media/default-popup.png"))).toString(
      "base64",
    ),
  e: 1,
  sid: "program-image",
};
data.assets.push(imageAsset);
data.slots["program-image"] = { p: { ...imageAsset } };
delete data.slots["program-image"].p.sid;
data.assets
  .find((a) => a.id === "comp_1")
  .layers.push({
    ddd: 0,
    ind: 3,
    ty: 2,
    nm: "Image programme",
    refId: "program-photo",
    sr: 1,
    ks: {
      o: { a: 0, k: 100 },
      r: { a: 0, k: 0 },
      p: { a: 0, k: [0, 0, 0] },
      a: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
    },
    ip: 0,
    op: 750,
    st: 0,
    bm: 0,
  });
for (const font of data.fonts.list) font.fPath = `/fonts/${font.fName}.ttf`;
await mkdir("public/templates", { recursive: true });
await mkdir("public/fonts", { recursive: true });
await mkdir("public/thumbnails", { recursive: true });
await writeFile("public/templates/btv-popup.json", JSON.stringify(data));
await writeFile(
  "public/templates/btv-popup.lottie",
  zipSync({
    "manifest.json": strToU8(
      JSON.stringify({
        version: "2",
        generator: "SRTB Graphics",
        animations: [{ id: "btv-popup", name: "Pop-up BTV" }],
      }),
    ),
    "a/btv-popup.json": strToU8(JSON.stringify(data)),
  }),
);
for (const font of data.fonts.list)
  await copyFile(
    path.join(source, "lib/fonts", `${font.fName}.otf`),
    `public/fonts/${font.fName}.otf`,
  );
console.log(
  "Prepared BTV Pop-up copy with native slots. Broadcast source untouched.",
);
