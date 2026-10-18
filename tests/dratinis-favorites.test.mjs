import test from "node:test";
import assert from "node:assert/strict";
import { favoriteKey, favoriteArchiveEntries } from "../dratinis/favorites-store.js";
import { zip, crc32 } from "../js/zip.js";

const metadata = (filename = "layer.png") => ({
  schemaVersion: 1, exportedAt: "2026-10-18T12:00:00.000Z",
  canvas: { width: 932, height: 1006, background: "#AABBCC" },
  layerOrder: "bottom-to-top", layerCount: 1,
  layers: [{ position: 1, filename, effect: { type: "halftone", name: "Color halftone", seed: 42 } }],
});

test("favorite identity ignores timestamps but distinguishes artwork, effects, order and background", () => {
  const original = metadata();
  const key = favoriteKey(original);
  const later = structuredClone(original);
  later.exportedAt = "2026-10-19T12:00:00.000Z";
  later.canvas.background = "#aabbcc";
  assert.equal(favoriteKey(later), key);
  for (const change of [
    value => { value.canvas.background = "#ffffff"; },
    value => { value.layers[0].filename = "other.png"; },
    value => { value.layers[0].effect.seed++; },
    value => { value.layers[0].effect = null; },
  ]) {
    const changed = structuredClone(original); change(changed);
    assert.notEqual(favoriteKey(changed), key);
  }
  const two = metadata(); two.layers.push({ filename: "second.png", effect: null });
  const before = favoriteKey(two); two.layers.reverse();
  assert.notEqual(favoriteKey(two), before);
});

test("500 favorites produce a valid ZIP with 500 PNGs and matching JSONs in jsons/", async () => {
  const favorites = Array.from({ length: 500 }, (_, index) => ({ id: `favorite-${index}` }));
  let fetched = 0, progress = 0;
  const entries = favoriteArchiveEntries(favorites, async id => {
    fetched++;
    return { id, png: new Blob([`PNG ${id}`]), metadata: metadata(`${id}.png`) };
  }, done => { progress = done; });
  const bytes = new Uint8Array(await (await zip(entries)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(fetched, 500);
  assert.equal(progress, 500);
  assert.equal(view.getUint16(bytes.length - 14, true), 1000);
  let offset = 0, files = new Map();
  const decoder = new TextDecoder();
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true);
    const name = decoder.decode(bytes.slice(offset + 30, offset + 30 + nameLength));
    const data = bytes.slice(offset + 30 + nameLength, offset + 30 + nameLength + size);
    assert.equal(crc32(data), view.getUint32(offset + 14, true));
    files.set(name, decoder.decode(data));
    offset += 30 + nameLength + size;
  }
  assert.equal(files.size, 1000);
  for (let index = 0; index < 500; index++) {
    const name = `dratini-${String(index + 1).padStart(3, "0")}-favorite-${index}`;
    assert.equal(files.get(`${name}.png`), `PNG favorite-${index}`);
    assert.deepEqual(JSON.parse(files.get(`jsons/${name}.json`)), metadata(`favorite-${index}.png`));
  }
});

test("collection export fails instead of silently skipping a removed favorite", async () => {
  await assert.rejects(zip(favoriteArchiveEntries([{ id: "missing" }], async () => undefined)), /removed during export/);
});
