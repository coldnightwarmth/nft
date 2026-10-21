import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { planLayerEffects, randomizeEnabledEffects, EFFECT_TYPES, ADDITIONAL_EFFECT_TYPES } from "../dratinis/effects.js";
import { createGenerationMetadata } from "../dratinis/metadata.js";
import { EYE_TRAITS, chooseEyeTrait, eyeAssetURLs } from "../dratinis/eyes.js";

const source = (await readFile(new URL("../dratinis/app.js", import.meta.url), "utf8"))
  .replace(/^import .*\n/gm, "")
  .replaceAll("import.meta.url", JSON.stringify("http://localhost/dratinis/app.js"));
const settle = () => new Promise(resolve => setImmediate(resolve));

async function app({ missingLocalEyes = false, missingHostedEyes = false } = {}) {
  const downloads = [], pendingEncodes = [], urls = new Map(), errors = [];
  const requests = [];
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
  const toggles = EFFECT_TYPES.map(type => {
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
    ResizeObserver: class { observe() {} }, planLayerEffects, createGenerationMetadata, randomizeEnabledEffects,
    chooseEyeTrait, eyeAssetURLs,
    createFavorites: () => ({ update() {}, close() {} }),
    createEffectRenderer: () => ({ draw: (drawing, image, recipe) => drawing.drawImage({
      layers: image.layers.map(filename => ({ filename, effect: recipe })),
    }) }),
    fetch: async url => {
      requests.push(url.href);
      const eye = EYE_TRAITS.find(trait => url.pathname.endsWith(trait.assetPath));
      return {
        ok: !eye || !(url.hostname === "coldnightwarmth.github.io" ? missingHostedEyes : missingLocalEyes),
        json: async () => ({ images: Array.from({ length: 307 }, (_, i) => `${i}.png`) }),
        blob: async () => eye?.filename ?? url.pathname.split("/").at(-1),
      };
    },
    createImageBitmap: async filename => ({ layers: filename instanceof Blob ? JSON.parse(await filename.text()) : [filename], close() {} }),
  });
  vm.runInContext(source, sandbox);
  await settle();
  const read = expression => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, sandbox));
  const state = () => read("({order:currentGeneration.order,count:currentGeneration.layerCount,effects:[...currentGeneration.effects],eye:currentGeneration.eye,pixels:foreground.layers})");
  return { el, toggles, downloads, pendingEncodes, errors, read, state, sandbox, requests };
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

test("eyes add one top layer, share FX odds, stay pinned on reorder, and undo exactly", async () => {
  const { el, toggles, state, errors } = await app();
  const before = state();
  el("#enable-eyes").checked = true;
  toggles[1].checked = true;
  el("#effect-chance").value = 100;
  await el("#enable-eyes").handlers.change();
  const withEyes = state();
  assert.equal(withEyes.count, before.count);
  assert.deepEqual(withEyes.pixels.slice(0, -1), before.pixels);
  assert.equal(withEyes.pixels.at(-1).filename, withEyes.eye.filename);
  assert.equal(withEyes.pixels.at(-1).effect.type, "overlay");
  await el("#reorder").handlers.click();
  assert.deepEqual(state().pixels.at(-1), withEyes.pixels.at(-1));
  assert.deepEqual(state().eye, withEyes.eye);
  el("#effect-chance").value = 0;
  await el("#shuffle-effects").handlers.click();
  assert.deepEqual(state().eye, withEyes.eye);
  assert.equal(state().pixels.at(-1).effect, null);
  for (const expected of [withEyes, before]) {
    el("#reorder").handlers.contextmenu({ preventDefault() {} });
    if (expected === before) el("#reorder").handlers.contextmenu({ preventDefault() {} });
    if (expected === withEyes) assert.deepEqual(state().pixels.at(-1), expected.pixels.at(-1));
    else assert.deepEqual(state(), expected);
  }
  assert.equal(el("#enable-eyes").checked, false);
  assert.deepEqual(errors, []);
});

test("99 Dratinis plus an eye export and recall with the eye separate from the slider", async () => {
  const { el, toggles, state, sandbox, read, errors } = await app();
  el("#layers").value = 99;
  await vm.runInContext("render()", sandbox);
  el("#enable-eyes").checked = true;
  await el("#enable-eyes").handlers.change();
  const original = state();
  assert.equal(original.pixels.length, 100);
  assert.equal(original.pixels.at(-1).effect, null);
  toggles[3].checked = true;
  el("#effect-chance").value = 100;
  el("#regenerate").handlers.click(); await settle();
  const saved = state();
  assert(EYE_TRAITS.some(trait => trait.filename === saved.eye.filename));
  assert.equal(saved.pixels.at(-1).effect.type, "halftone");
  const metadata = createGenerationMetadata({ order: saved.order, layerCount: saved.count, eye: saved.eye, effects: new Map(saved.effects) }, { width: 932, height: 1006, background: "#f3f0e8", exportedAt: "2026-10-18T12:00:00.000Z" });
  assert.equal(metadata.layerCount, 100);
  assert.equal(metadata.dratiniLayerCount, 99);
  assert.equal(metadata.layers.at(-1).position, 100);
  assert.equal(metadata.layers.at(-1).role, "eyes");
  assert.equal(metadata.layers.at(-1).assetPath, saved.eye.assetPath);
  assert.deepEqual(metadata.layers.map(({filename,effect}) => ({filename,effect:effect ? {type:effect.type,seed:effect.seed}:null})), saved.pixels);
  el("#enable-eyes").checked = false;
  await el("#enable-eyes").handlers.change();
  const without = state();
  assert.equal(without.pixels.length, 99);
  assert.deepEqual(without.pixels, saved.pixels.slice(0, -1));
  const record = { metadata, foreground: new Blob([JSON.stringify(saved.pixels)]) };
  await vm.runInContext("recallFavorite", sandbox)(async () => record);
  assert.equal(Number(el("#layers").value), 99);
  assert.equal(el("#enable-eyes").checked, true);
  assert.deepEqual(state().eye, saved.eye);
  assert.deepEqual(state().pixels, saved.pixels);
  assert.equal(read("order.includes(eyeLayer.filename)"), false);
  await el("#reorder").handlers.click();
  assert.deepEqual(state().pixels.at(-1), saved.pixels.at(-1));
  el("#shuffle-effects").handlers.contextmenu({ preventDefault() {} });
  el("#shuffle-effects").handlers.contextmenu({ preventDefault() {} });
  assert.deepEqual(state(), without);
  assert.equal(el("#enable-eyes").checked, false);
  assert.deepEqual(errors, []);
});

test("missing local eyes use the hosted asset, and failed loads preserve the current canvas", async () => {
  for (const missingHostedEyes of [false, true]) {
    const { el, state, requests, errors } = await app({ missingLocalEyes: true, missingHostedEyes });
    const before = state();
    el("#enable-eyes").checked = true;
    await el("#enable-eyes").handlers.change();
    assert(requests.some(url => url.startsWith("https://coldnightwarmth.github.io/nft/assets/drifella/")));
    if (missingHostedEyes) {
      assert.deepEqual(state(), before);
      assert.equal(el("#enable-eyes").checked, false);
      assert.equal(errors.length, 1);
    } else {
      assert.equal(state().pixels.length, before.count + 1);
      assert.deepEqual(errors, []);
    }
  }
});

test("a cancelled eye render cannot return after undo or a newer toggle", async () => {
  const { el, state, errors } = await app();
  const before = state();
  el("#enable-eyes").checked = true;
  const adding = el("#enable-eyes").handlers.change();
  el("#enable-eyes").checked = false;
  await el("#enable-eyes").handlers.change();
  await adding;
  assert.deepEqual(state().pixels, before.pixels);
  assert.equal(state().eye, null);
  assert.equal(el("#enable-eyes").checked, false);
  assert.deepEqual(errors, []);
});

test("the eye pool includes all three packs with unique source identities", () => {
  assert.equal(EYE_TRAITS.length, 338);
  assert.deepEqual([...new Set(EYE_TRAITS.map(eye => eye.pack))].sort(), ["drif3", "drifella", "drifella2"]);
  assert.equal(new Set(EYE_TRAITS.map(eye => eye.filename)).size, EYE_TRAITS.length);
  for (let i = 0; i < EYE_TRAITS.length; i++) {
    assert.equal(chooseEyeTrait(() => (i + 0.5) / EYE_TRAITS.length), EYE_TRAITS[i]);
  }
});

test("every added effect survives reorder, undo and favorite recall on Dratinis and eyes", async () => {
  const { el, toggles, state, sandbox, errors } = await app();
  el("#enable-eyes").checked = true;
  await el("#enable-eyes").handlers.change();
  el("#effect-chance").value = 100;
  for (const type of ADDITIONAL_EFFECT_TYPES) {
    toggles.forEach(toggle => { toggle.checked = toggle.dataset.effect === type; });
    await el("#shuffle-effects").handlers.click();
    const saved = state();
    assert(saved.pixels.every(layer => layer.effect.type === type));
    const record = {
      metadata: createGenerationMetadata({ order: saved.order, layerCount: saved.count, effects: new Map(saved.effects), eye: saved.eye }, { width: 932, height: 1006, background: "#f3f0e8", exportedAt: "2026-10-18T00:00:00Z" }),
      foreground: new Blob([JSON.stringify(saved.pixels)]),
    };
    await el("#reorder").handlers.click();
    assert.deepEqual(state().pixels.at(-1), saved.pixels.at(-1));
    el("#reorder").handlers.contextmenu({ preventDefault() {} });
    assert.deepEqual(state(), saved);
    await el("#shuffle-effects").handlers.click();
    await vm.runInContext("recallFavorite", sandbox)(async () => record);
    assert.deepEqual(state().pixels, saved.pixels);
    assert.deepEqual(state().eye, saved.eye);
  }
  assert.deepEqual(errors, []);
});

test("Randomize FX picks a new enabled set per Regenerate and applies it to layers and eyes", async () => {
  const { el, toggles, state, sandbox, errors } = await app();
  const enabled = () => toggles.filter(toggle => toggle.checked).map(toggle => toggle.dataset.effect);
  toggles[0].checked = true;
  el("#effect-chance").value = 100;
  el("#enable-eyes").checked = true;
  await el("#enable-eyes").handlers.change();
  let rolls = 0;
  const choices = [["duotone", "wave"], ["negative"], []];
  sandbox.randomizeEnabledEffects = () => choices[rolls++];
  // Manual mode stays unchanged until the master switch is on.
  await el("#regenerate").handlers.click();
  assert.equal(rolls, 0);
  assert.deepEqual(enabled(), ["pixelation"]);
  const original = state();
  el("#randomize-effects").checked = true;
  el("#randomize-effects").handlers.change();
  assert.equal(rolls, 0);
  assert.deepEqual(state(), original);
  for (const choice of choices) {
    const before = state();
    await el("#regenerate").handlers.click();
    assert.deepEqual(enabled(), choice);
    assert.equal(el("#enable-eyes").checked, true);
    assert.equal(Number(el("#effect-chance").value), 100);
    assert(state().pixels.every(layer => choice.length ? choice.includes(layer.effect?.type) : layer.effect === null));
    const rolled = state();
    el("#regenerate").handlers.contextmenu({ preventDefault() {} });
    assert.deepEqual(state(), before);
    // Reorder, Shuffle FX and the layer slider do not flip the switches again.
    await el("#reorder").handlers.click();
    await el("#shuffle-effects").handlers.click();
    el("#layers").value = 5;
    await vm.runInContext("render()", sandbox);
    assert.deepEqual(enabled(), choice);
    assert.equal(rolled.pixels.at(-1).filename, rolled.eye.filename);
  }
  assert.equal(rolls, 3);
  el("#randomize-effects").checked = false;
  el("#randomize-effects").handlers.change();
  toggles.find(toggle => toggle.dataset.effect === "chrome").checked = true;
  await el("#regenerate").handlers.click();
  assert.equal(rolls, 3);
  assert.deepEqual(enabled(), ["chrome"]);
  assert.deepEqual(errors, []);
});
