import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { planLayerEffects } from "../dratinis/effects.js";
import { createGenerationMetadata } from "../dratinis/metadata.js";

const source = (await readFile(new URL("../dratinis/app.js", import.meta.url), "utf8"))
  .replace(/^import .*\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify("http://localhost/dratinis/app.js"));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function app() {
  const downloads = [], pendingEncodes = [], urls = new Map(), errors = [];
  class Element {
    value = ""; disabled = false; hidden = true; width = 932; height = 1006;
    clientWidth = 1440; clientHeight = 950; layers = []; attrs = {}; handlers = {};
    dataset = {}; checked = false; style = { setProperty() {} };
    classList = { add() {}, toggle() {} };
    addEventListener(type, fn) { this.handlers[type] = fn; }
    setAttribute(key, value) { this.attrs[key] = value; }
    focus() {} contains() { return false; } remove() {}
    click() { downloads.push({ filename: this.download, blob: urls.get(this.href) }); }
    toBlob(callback, type) {
      const snapshot = JSON.stringify(this.layers);
      pendingEncodes.push(() => callback(new Blob([snapshot], { type })));
    }
    getContext() {
      return {
        clearRect: () => { this.layers = []; },
        fillRect: () => { this.layers = []; },
        drawImage: image => this.layers.push(...image.layers),
      };
    }
  }
  const elements = new Map();
  const el = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  el("#layers").value = 12;
  el("#background").value = "#f3f0e8";
  el("#effect-chance").value = 50;
  const toggles = ["pixelation", "overlay", "blur", "halftone"].map(type => {
    const input = new Element(); input.dataset.effect = type; return input;
  });
  const document = {
    querySelector: el, querySelectorAll: () => toggles, createElement: () => new Element(),
    documentElement: new Element(), addEventListener() {}, body: { append() {} },
  };
  class BrowserURL extends URL {
    static createObjectURL(blob) { const url = `blob:${urls.size}`; urls.set(url, blob); return url; }
    static revokeObjectURL(url) { urls.delete(url); }
  }
  const sandbox = vm.createContext({
    document, window: { addEventListener() {} }, URL: BrowserURL, AbortController, Map, Math, Blob,
    console: { error: error => errors.push(error) }, clearTimeout,
    setTimeout: (callback, delay) => delay === 60_000 ? 0 : setTimeout(callback, delay),
    ResizeObserver: class { observe() {} }, planLayerEffects, createGenerationMetadata,
    createFavorites: () => ({ update() {}, close() {} }),
    createEffectRenderer: () => ({ draw: (drawing, image, recipe) => drawing.drawImage({
      layers: image.layers.map(filename => ({ filename, effect: recipe })),
    }) }),
    fetch: async url => ({
      ok: true, json: async () => ({ images: Array.from({ length: 307 }, (_, i) => `${i}.png`) }),
      blob: async () => url.pathname.split("/").at(-1),
    }),
    createImageBitmap: async filename => ({ layers: filename instanceof Blob ? JSON.parse(await filename.text()) : [filename], close() {} }),
  });
  vm.runInContext(source, sandbox);
  await settle();
  const read = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, sandbox));
  const state = () => read("({order:currentGeneration.order,count:currentGeneration.layerCount,effects:[...currentGeneration.effects],pixels:foreground.layers})");
  return { el, toggles, downloads, pendingEncodes, errors, read, state, sandbox };
}

test("Reorder and Shuffle FX each undo through the shared last 10 exact compositions", async () => {
  for (const undoButton of ["#reorder", "#shuffle-effects"]) {
    const { el, toggles, read, state, errors } = await app();
    toggles.forEach(toggle => { toggle.checked = true; });
    el("#effect-chance").value = 100;
    const snapshots = [];
    for (let i = 0; i < 13; i++) {
      snapshots.push(state());
      await el(i % 2 ? "#reorder" : "#shuffle-effects").handlers.click();
    }
    assert.equal(read("generationHistory.length"), 10);
    for (const snapshot of snapshots.slice(-10).reverse()) {
      let prevented = false;
      el(undoButton).handlers.contextmenu({ preventDefault() { prevented = true; } });
      assert(prevented);
      assert.deepEqual(state(), snapshot);
    }
    const oldest = state();
    el(undoButton).handlers.contextmenu({ preventDefault() {} });
    assert.deepEqual(state(), oldest);
    for (const button of ["#regenerate", "#reorder", "#shuffle-effects"]) {
      assert.match(el(button).title, /0 available/);
    }
    assert.deepEqual(errors, []);
  }
});

test("Reorder can undo a single-layer canvas and cancels a pending render", async () => {
  const { el, state, sandbox, errors } = await app();
  const original = state();
  el("#layers").value = 1;
  await vm.runInContext("render()", sandbox);
  assert.equal(el("#reorder").disabled, false);
  el("#regenerate").handlers.click();
  el("#reorder").handlers.contextmenu({ preventDefault() {} });
  await settle();
  assert.deepEqual(state(), original);
  assert.equal(el("#canvas").attrs["aria-busy"], "false");
  assert.deepEqual(errors, []);
});

test("PNG and JSON capture the same visible generation while rendering and encoding overlap", async () => {
  const { el, toggles, state, downloads, pendingEncodes, sandbox, errors } = await app();
  toggles[1].checked = true;
  el("#effect-chance").value = 100;
  await el("#shuffle-effects").handlers.click();
  // A later layer-count decrease leaves unused recipes in the map: don't export those.
  el("#layers").value = 3;
  await vm.runInContext("render()", sandbox);
  el("#background").value = "#123456";
  el("#background").handlers.input();
  const visible = state();
  // Changed settings and a pending generation must not leak into the export.
  toggles[1].checked = false;
  el("#effect-chance").value = 0;
  el("#layers").value = 7;
  el("#regenerate").handlers.click();
  const exporting = el("#download").handlers.click();
  await el("#download").handlers.click(); // Ignore a duplicate click during encoding.
  await settle();
  assert.equal(state().count, 7);
  el("#background").value = "#ffffff";
  el("#background").handlers.input();
  pendingEncodes.shift()();
  await exporting;
  assert.equal(downloads.length, 2);
  const [png, json] = downloads;
  assert.equal(png.blob.type, "image/png");
  assert.equal(json.blob.type, "application/json");
  assert.equal(png.filename.replace(/\.png$/, ""), json.filename.replace(/\.json$/, ""));
  const metadata = JSON.parse(await json.blob.text());
  assert.deepEqual(metadata.canvas, { width: 932, height: 1006, background: "#123456" });
  assert.equal(metadata.layerOrder, "bottom-to-top");
  assert.equal(metadata.layerCount, 3);
  assert.deepEqual(metadata.layers.map(layer => layer.filename), visible.order.slice(0, 3));
  assert.deepEqual(metadata.layers.map(layer => layer.position), [1, 2, 3]);
  assert(metadata.layers.every(layer => layer.effect.name === "Color overlay"));
  assert.deepEqual(metadata.layers.map(({ filename, effect: { type, seed } }) => ({ filename, effect: { type, seed } })), JSON.parse(await png.blob.text()));
  assert.equal(el("#download").disabled, false);
  assert.deepEqual(errors, []);
});

test("JSON explicitly marks layers without effects and exports a detached snapshot", () => {
  const recipe = { type: "halftone", seed: 9876 };
  const generation = { order: ["untouched.png", "dots.png", "unused.png"], layerCount: 2,
    effects: new Map([["untouched.png", null], ["dots.png", recipe]]) };
  const result = createGenerationMetadata(generation, { width: 932, height: 1006, background: "#ffffff", exportedAt: "2026-10-18T18:00:00.000Z" });
  recipe.seed = 1;
  assert.equal(result.layers.length, 2);
  assert.equal(result.layers[0].effect, null);
  assert.deepEqual(result.layers[1].effect, { type: "halftone", name: "Color halftone", seed: 9876 });
});

test("favorite recall restores exact foreground, layers, effects and background and can be undone", async () => {
  const { el, toggles, state, sandbox, errors } = await app();
  toggles[2].checked = true;
  el("#effect-chance").value = 100;
  await el("#shuffle-effects").handlers.click();
  el("#background").value = "#123456";
  el("#background").handlers.input();
  const saved = state();
  const record = {
    metadata: createGenerationMetadata({ order: saved.order, layerCount: saved.count, effects: new Map(saved.effects) }, { width: 932, height: 1006, background: "#123456", exportedAt: "2026-10-18T12:00:00.000Z" }),
    foreground: new Blob([JSON.stringify(saved.pixels)]),
  };
  el("#layers").value = 5;
  el("#background").value = "#ffffff";
  el("#regenerate").handlers.click(); await settle();
  const beforeRecall = state();
  assert.equal(await vm.runInContext("recallFavorite", sandbox)(async () => record), true);
  assert.deepEqual(state().pixels, saved.pixels);
  assert.deepEqual(state().order.slice(0, saved.count), saved.order.slice(0, saved.count));
  assert.deepEqual(state().effects, saved.effects);
  assert.equal(el("#background").value, "#123456");
  el("#shuffle-effects").handlers.contextmenu({ preventDefault() {} });
  assert.deepEqual(state(), beforeRecall);
  assert.equal(el("#background").value, "#ffffff");
  assert.deepEqual(errors, []);
});

test("a delayed favorite recall cannot replace a newer generation", async () => {
  const { el, state, sandbox } = await app();
  let release;
  const recalling = vm.runInContext("recallFavorite", sandbox)(() => new Promise(resolve => { release = resolve; }));
  el("#regenerate").handlers.click(); await settle();
  const newer = state();
  release(undefined);
  assert.equal(await recalling, false);
  assert.deepEqual(state(), newer);
  assert.equal(el("#canvas").attrs["aria-busy"], "false");
});
