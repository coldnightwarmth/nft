import test from "node:test";
import assert from "node:assert/strict";
import { chooseLayerEffect, planLayerEffects, EFFECT_TYPES } from "../dratinis/effects.js";

test("disabled effects and zero chance leave layers untouched", () => {
  const unexpectedRandom = () => { throw new Error("No random draw should be needed"); };
  assert.equal(chooseLayerEffect({ enabled: [], chance: 100 }, unexpectedRandom), null);
  assert.equal(chooseLayerEffect({ enabled: EFFECT_TYPES, chance: 0 }, unexpectedRandom), null);
  assert.equal(chooseLayerEffect({ enabled: ["unknown"], chance: 100 }, unexpectedRandom), null);
});

test("chance is rolled once per layer, then selects one enabled effect", () => {
  const draws = [0.49, 0.3, 0.5];
  assert.deepEqual(chooseLayerEffect({ enabled: EFFECT_TYPES, chance: 50 }, () => draws.shift()), {
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
  const settings = { enabled: EFFECT_TYPES, chance: 100 };
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
