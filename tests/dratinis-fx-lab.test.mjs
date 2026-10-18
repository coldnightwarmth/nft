import test from "node:test";
import assert from "node:assert/strict";
import { EFFECTS, sampleLayers, seededRandom, transformPixels } from "../dratinis/fx/effects.js";

const pixelEffects = ["posterize", "duotone", "negative", "solarize", "stencil", "dither", "engraving", "emboss", "chrome"];
function fixture() {
  const width = 32, height = 24, input = new Uint8ClampedArray(width * height * 4), light = new Float32Array(width * height);
  for (let i = 0; i < light.length; i++) {
    const p = i * 4;
    input[p] = i % 256; input[p + 1] = i * 7 % 256; input[p + 2] = i * 13 % 256;
    input[p + 3] = [0, 40, 160, 255][i % 4];
    light[i] = (input[p] * .2126 + input[p + 1] * .7152 + input[p + 2] * .0722) / 255;
  }
  return { input, light, width, height };
}

test("gallery exposes 20 distinct effects and draws four unique samples without changing the library", () => {
  assert.equal(EFFECTS.length, 20);
  assert.equal(new Set(EFFECTS.map(effect => effect.id)).size, 20);
  const images = Array.from({ length: 307 }, (_, i) => `${i}.png`), before = [...images];
  const selected = sampleLayers(images, 4, seededRandom(1));
  assert.equal(selected.length, 4); assert.equal(new Set(selected).size, 4);
  assert.deepEqual(images, before);
  assert.deepEqual(sampleLayers(images, 4, seededRandom(1)), selected);
  assert.notDeepEqual(sampleLayers(images, 4, seededRandom(2)), selected);
});

test("tonal and texture effects change pixels without losing alpha or mutating the original", () => {
  const { input, light, width, height } = fixture(), original = input.slice();
  for (const type of pixelEffects) {
    const result = transformPixels(input, light, width, height, type, 97);
    assert.equal(result.length, input.length);
    assert.notDeepEqual(result, input, type);
    for (let i = 3; i < input.length; i += 4) assert.equal(result[i], input[i], `${type}: alpha at ${i}`);
    assert.deepEqual(transformPixels(input, light, width, height, type, 97), result, `${type}: repeatable seed`);
  }
  assert.deepEqual(input, original);
});

test("negative inverts visible colors exactly; a stencil has exactly two visible inks", () => {
  const { input, light, width, height } = fixture();
  const negative = transformPixels(input, light, width, height, "negative", 1);
  for (let p = 0; p < input.length; p += 4) if (input[p + 3]) {
    for (let c = 0; c < 3; c++) assert.equal(negative[p + c], 255 - input[p + c]);
  }
  const stencil = transformPixels(input, light, width, height, "stencil", 1), inks = new Set();
  for (let p = 0; p < stencil.length; p += 4) if (stencil[p + 3]) inks.add([...stencil.slice(p, p + 3)].join(","));
  assert.equal(inks.size, 2);
});
