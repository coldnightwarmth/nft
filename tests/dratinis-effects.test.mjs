import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chooseLayerEffect, planLayerEffects, randomizeEnabledEffects, EFFECT_TYPES, EFFECT_NAMES, ADDITIONAL_EFFECT_TYPES } from "../dratinis/effects.js";
import { createGenerationMetadata } from "../dratinis/metadata.js";
import { waveCoordinates } from "../dratinis/fx/effects.js";

const originalEffects = ["pixelation", "overlay", "blur", "halftone"];

test("Randomize FX independently flips every effect with equal on/off odds", () => {
  assert.deepEqual(randomizeEnabledEffects(() => 0), EFFECT_TYPES);
  assert.deepEqual(randomizeEnabledEffects(() => .5), []);
  let index = 0;
  assert.deepEqual(randomizeEnabledEffects(() => index++ % 2 ? .75 : .25), EFFECT_TYPES.filter((_, i) => i % 2 === 0));
  assert.equal(index, 17);
});

test("disabled effects and zero chance leave layers untouched", () => {
  const unexpectedRandom = () => { throw new Error("No random draw should be needed"); };
  assert.equal(chooseLayerEffect({ enabled: [], chance: 100 }, unexpectedRandom), null);
  assert.equal(chooseLayerEffect({ enabled: EFFECT_TYPES, chance: 0 }, unexpectedRandom), null);
  assert.equal(chooseLayerEffect({ enabled: ["unknown"], chance: 100 }, unexpectedRandom), null);
});

test("chance is rolled once per layer, then selects one enabled effect", () => {
  const draws = [0.49, 0.3, 0.5];
  assert.deepEqual(chooseLayerEffect({ enabled: originalEffects, chance: 50 }, () => draws.shift()), {
    type: "overlay", seed: 0x80000000,
  });
  assert.equal(draws.length, 0);
  assert.equal(chooseLayerEffect({ enabled: EFFECT_TYPES, chance: 50 }, () => 0.5), null);
  for (const type of EFFECT_TYPES) {
    assert.equal(chooseLayerEffect({ enabled: [type], chance: 100 }, () => 0.999).type, type);
  }
});

test("enabled effects have equal odds independent of how many are enabled", () => {
  let seed = 42;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
  for (const enabled of [EFFECT_TYPES, ["overlay", "halftone"]]) {
    const counts = Object.fromEntries(enabled.map(type => [type, 0]));
    let applied = 0;
    for (let i = 0; i < 100000; i++) {
      const effect = chooseLayerEffect({ enabled, chance: 40 }, random);
      if (effect) { applied++; counts[effect.type]++; }
    }
    assert.ok(Math.abs(applied / 100000 - 0.4) < 0.01);
    for (const count of Object.values(counts)) assert.ok(Math.abs(count / applied - 1 / enabled.length) < 0.015);
  }
});

test("reorder and new layers preserve existing recipes, including no-effect decisions", () => {
  const settings = { enabled: originalEffects, chance: 100 };
  const original = planLayerEffects(["a.png", "b.png"], settings, new Map(), () => 0.25);
  original.set("c.png", null);
  const reordered = planLayerEffects(["c.png", "b.png", "a.png", "d.png"], settings, original, () => 0.75);
  assert.notEqual(reordered, original);
  for (const file of original.keys()) assert.equal(reordered.get(file), original.get(file));
  assert.equal(original.has("d.png"), false);
  assert.equal(reordered.get("d.png").type, "halftone");
  assert.equal(reordered.get("d.png").seed, 0xc0000000);
  assert.equal(Object.isFrozen(reordered.get("d.png")), true);
  assert.equal(planLayerEffects(["c.png"], settings, new Map(), () => 0.25).get("c.png").type, "overlay");
});

test("all 17 effects have individual switches and complete export names, including eye layers", async () => {
  const html = await readFile(new URL("../dratinis/index.html", import.meta.url), "utf8");
  const switches = [...html.matchAll(/data-effect="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(switches, EFFECT_TYPES);
  assert.equal(ADDITIONAL_EFFECT_TYPES.length, 13);
  assert.equal(EFFECT_TYPES.length, 17);
  for (const type of EFFECT_TYPES) {
    const recipe = chooseLayerEffect({ enabled: [type], chance: 100 }, () => .25);
    const metadata = createGenerationMetadata({
      order: ["dratini.png"], layerCount: 1,
      eye: { filename: "eye.png", pack: "drif3", assetPath: "drifella/eye.webp" },
      effects: new Map([["dratini.png", recipe], ["eye.png", recipe]]),
    }, { width: 932, height: 1006, background: "#ffffff", exportedAt: "2026-10-18T00:00:00Z" });
    assert(metadata.layers.every(layer => layer.effect.name === EFFECT_NAMES[type] && layer.effect.type === type));
    assert.equal(metadata.layers.at(-1).role, "eyes");
  }
});

test("wave distortion uses broad bends with over five times the previous displacement", () => {
  const width = 932, height = 1006;
  const [x, y] = waveCoordinates(0, 0, width, height, Math.PI / 2);
  assert(x > width * .035 * 5);
  assert(y > height * .018 * 5);
  // Scaling the canvas keeps the same relative bend.
  const scaled = waveCoordinates(0, 0, width / 2, height / 2, Math.PI / 2);
  assert.deepEqual(scaled, [x / 2, y / 2]);
});
