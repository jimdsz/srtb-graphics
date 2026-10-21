import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import {
  assertFontsAvailable,
  parseTemplate,
} from "../src/lib/template-loader";

const basic = () => ({
  v: "5.12.2",
  w: 1920,
  h: 1080,
  fr: 25,
  ip: 0,
  op: 250,
  layers: [],
  assets: [],
});
const parse = (obj: object) =>
  parseTemplate(strToU8(JSON.stringify(obj)), "test.json");
test("reads the real BTV JSON and dotLottie with identical metadata", async () => {
  const json = parseTemplate(
    await readFile("public/templates/btv-popup.json"),
    "btv.json",
  );
  const lottie = parseTemplate(
    await readFile("public/templates/btv-popup.lottie"),
    "btv.lottie",
  );
  assert.deepEqual(json.info, lottie.info);
  assert.equal(json.info.duration, 12.04);
  assert.equal(lottie.animationId, "btv-popup");
  assertFontsAvailable(json.source);
});
test("explicit errors for malformed files and missing mandatory fields", () => {
  assert.throws(
    () => parseTemplate(strToU8("{broken"), "broken.json"),
    /JSON invalide/,
  );
  assert.throws(() => parseTemplate(strToU8("{}"), "broken.lottie"), /Archive/);
  assert.throws(() => parse({}), /Lottie valide/);
  assert.throws(
    () => parseTemplate(strToU8("{}"), "unsupported.zip"),
    /Format attendu/,
  );
});
test("bounds dimensions, frame rate, duration and file size", () => {
  for (const invalid of [
    { w: 0 },
    { h: 9000 },
    { w: 1.1 },
    { fr: 0 },
    { fr: 121 },
    { op: 0 },
    { op: 4000 },
  ])
    assert.throws(() => parse({ ...basic(), ...invalid }));
  assert.throws(
    () => parseTemplate(new Uint8Array(20 * 1024 * 1024 + 1), "test.json"),
    /20 Mo/,
  );
});
test("rejects archives with traversing paths or excessive expansion", () => {
  assert.throws(
    () =>
      parseTemplate(
        zipSync({ "../unsafe.json": strToU8("{}") }),
        "test.lottie",
      ),
    /Archive/,
  );
  const entries = Object.fromEntries(
    Array.from({ length: 513 }, (_, i) => [`f${i}`, new Uint8Array()]),
  );
  assert.throws(
    () => parseTemplate(zipSync(entries), "test.lottie"),
    /Archive/,
  );
});
test("does not silently request or ignore external images", () => {
  assert.throws(
    () =>
      parse({
        ...basic(),
        assets: [{ id: "image", p: "https://example.com/private.png" }],
      }),
    /Média manquant ou externe/,
  );
});
test("reports optional JSON fallback without implementing arbitrary editing", () => {
  assert.equal(
    parse({ ...basic(), layers: [{ ty: 5 }] }).potentialFallback,
    true,
  );
  assert.equal(parse(basic()).potentialFallback, false);
});
test("missing original font blocks substitution", () => {
  assert.throws(
    () =>
      assertFontsAvailable({
        ...basic(),
        layers: [
          { ty: 5, t: { d: { k: [{ s: { f: "UnknownBrandFont" } }] } } },
        ],
      }),
    /Police non préparée/,
  );
});
