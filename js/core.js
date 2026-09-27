import {
  LAYERS as SOURCE_LAYERS,
  PACKS as SOURCE_PACKS,
} from "./library.js?v=drifella-3";
const REPEATED = {
  "2pencil":"pencil", "3pencil 2":"pencil",
  "4paint":"paint", "5paint 2":"paint",
  "6additive":"additive", "6additive - copy":"additive", "6additive - copy - copy":"additive",
  "98strokes":"strokes", "99strokes 2":"strokes", "991strokes 3":"strokes",
};
export const categoryLayer = layer => REPEATED[layer] || layer;
export const categoryLabel = layer => categoryLayer(layer).replace(/^custom:/, "").replace(/^\d+[ _-]*/, "");
const repeatDefaults = {pencil:2, paint:2, additive:3, strokes:3};
// Semantic aliases only: repeated paint/stroke/additive passes remain independent.
const MERGED = {
  "11cloth": "cloth",
  "5cloth": "cloth",
  "15left": "left",
  "92left": "left",
  "16right": "right",
  "93right": "right",
  "90drifellabase": "body",
  "3drifellabody": "body",
  "93mouth": "mouth",
  "7mouth": "mouth",
  "94eyes": "eyes",
  "9eyes": "eyes",
  "95head": "head",
  "91head": "head",
  "993overlay": "overlay",
  "94overlay": "overlay",
  "4tattoos": "tattoos",
  "6accesory": "accessory",
  "8nose": "nose",
  "95noise": "noise",
  "2background+": "background+",
};
export const mergedLayer = (layer) => REPEATED[layer] || MERGED[layer] || layer;
const ALL_ORDER = [
  "background",
  "background+",
  "2pencil",
  "3pencil 2",
  "4paint",
  "5paint 2",
  "6additive",
  "6additive - copy",
  "6additive - copy - copy",
  "7over",
  "8base pixel line",
  "body",
  "91base plus",
  "tattoos",
  "cloth",
  "accessory",
  "left",
  "right",
  "mouth",
  "nose",
  "eyes",
  "head",
  "98strokes",
  "99strokes 2",
  "991strokes 3",
  "992numbers",
  "overlay",
  "noise",
];
export const PACKS = [
  ...SOURCE_PACKS.map(p => ({...p, layers:[...new Set(p.layers.map(categoryLayer))]})),
  { id: "custom", name: "Custom folder", layers: [] },
  { id: "all", name: "All Drifella sets", layers: [...new Set(ALL_ORDER.map(categoryLayer))] },
];
export const LAYERS = [...new Set([...SOURCE_LAYERS, ...ALL_ORDER, ...Object.values(REPEATED)])];
export function assetsForPack(assets, pack) {
  const seen = new Set();
  return assets
    .filter((a) =>
      pack === "custom"
        ? a.pack === "custom"
        : (pack === "all" && a.pack !== "custom") ||
          !a.pack ||
          a.pack === "all" ||
          a.pack === pack ||
          a.layer === "sprite",
    )
    .map((a) =>
      pack === "all"
        ? {
            ...a,
            sourceLayer: a.sourceLayer || a.layer,
            layer: mergedLayer(a.layer),
          }
        : {...a, sourceLayer: a.sourceLayer || a.layer, layer: categoryLayer(a.layer)},
    )
    .filter(a => {
      // Hosted filenames are SHA-256 hashes of the original image bytes.
      // Local filenames alone cannot establish identical image contents.
      if ((pack !== "all" && !repeatDefaults[a.layer]) || a.source === "local" || !/^drifella\/[a-f0-9]{64}\.webp$/.test(a.path || "")) return true;
      const key = `${a.layer}:${a.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
export const validCustomLayer = (l) =>
  typeof l === "string" &&
  l.startsWith("custom:") &&
  l.length > 7 &&
  l.length < 250;
export function customLayerFromPath(path) {
  const parts = path.replaceAll("\\", "/").split("/");
  const folder = parts.length > 2 ? parts[1] : "images";
  if (/^(?:\d+[\s_-]*)?(?:backgrounds?|bgs?)$/i.test(folder)) return "background";
  if (/^sprites?$/i.test(folder)) return "sprite";
  return `custom:${folder}`;
}
export const DEFAULTS = {
  profile: "drifella-v1",
  pack: "drif3",
  width: 932,
  height: 1006,
  count: 6,
  color: "#000000",
  randomOrder: false,
  jitter: false,
  disabledAssets: [],
  customLayers: [],
  additionalLayers: {},
  layerOrders: {},
  repeats: repeatDefaults,
  spriteMean: 2.2,
  spriteMax: 16,
  burstChance: 0.12,
  empty: Object.fromEntries(LAYERS.map((l) => [l, 0])),
  enabled: Object.fromEntries(LAYERS.map((l) => [l, l !== "sprite"])),
};
function baseLayers(settings) {
  if (settings.pack === "custom")
    return [...new Set([...(settings.customLayers || []), "sprite"])];
  return [...new Set([
    ...(PACKS.find((p) => p.id === settings.pack) || PACKS[0]).layers,
    ...Object.entries(settings.additionalLayers || {}).filter(([pack]) => pack === settings.pack || pack === "all" || (settings.pack === "all" && pack !== "custom")).flatMap(([, layers]) => layers),
    "sprite",
  ])];
}
export function activeLayers(settings) {
  const layers = baseLayers(settings);
  const saved = settings.layerOrders?.[settings.pack] || [];
  return [...new Set([...saved.map(categoryLayer).filter(l => layers.includes(l)), ...layers])];
}
export function assetTraits(filename) {
  const stem = filename.replace(/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i, "");
  const match = stem.match(/\$(\d+(?:\.\d+)?)$/);
  const name = stem.replace(/\$\d+(?:\.\d+)?$/, "");
  return {
    name,
    weight: match ? Number(match[1]) : 1,
    empty: /^(none|empty)$/i.test(name.trim()),
  };
}
export const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i;
export const clone = (v) => structuredClone(v);
export function layerName(name) {
  let n = name.toLowerCase().trim();
  if (["bg", "bgs", "backgrounds", "1bg", "1background"].includes(n))
    return "background";
  if (n === "sprites") return "sprite";
  n = n.replaceAll("_", " ");
  return LAYERS.includes(n) ? n : null;
}
export function inferLayer(path) {
  const parts = path.replaceAll("\\", "/").split("/").slice(0, -1);
  for (let i = parts.length - 1; i >= 0; i--) {
    const l = layerName(parts[i]);
    if (l) return l;
  }
  return null;
}
export function normalizeSettings(s = {}) {
  const number = (v, d, min, max) =>
    Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : d;
  const legacy = s.profile !== DEFAULTS.profile;
  if (legacy)
    s = {
      ...s,
      width: s.width === 2000 && s.height === 2800 ? 932 : s.width,
      height: s.width === 2000 && s.height === 2800 ? 1006 : s.height,
      randomOrder: false,
      jitter: false,
      enabled: { ...s.enabled, sprite: false },
    };
  const out = { ...clone(DEFAULTS), ...s, profile: DEFAULTS.profile };
  out.disabledAssets = [
    ...new Set(
      Array.isArray(s.disabledAssets)
        ? s.disabledAssets.filter((id) => typeof id === "string")
        : [],
    ),
  ];
  out.customLayers = [
    ...new Set(
      (Array.isArray(s.customLayers) ? s.customLayers : []).filter(
        (l) => validCustomLayer(l) || l === "background" || l === "sprite",
      ),
    ),
  ];
  out.additionalLayers = Object.fromEntries(PACKS.map(({id}) => [id,
    [...new Set((Array.isArray(s.additionalLayers?.[id]) ? s.additionalLayers[id] : []).filter(validCustomLayer))]
  ]));
  out.layerOrders = Object.fromEntries(PACKS.map(({id}) => [id,
    [...new Set((Array.isArray(s.layerOrders?.[id]) ? s.layerOrders[id] : []).filter(l => LAYERS.includes(l) || validCustomLayer(l)))]
  ]));
  out.pack = PACKS.some((p) => p.id === s.pack) ? s.pack : DEFAULTS.pack;
  out.width = Math.round(number(s.width, 932, 100, 4096));
  out.height = Math.round(number(s.height, 1006, 100, 4096));
  out.count = Math.round(number(s.count, 6, 1, 12));
  if (out.count === 4) out.count = 3; // Migrate saved settings and presets.
  out.spriteMean = number(s.spriteMean, 2.2, 0, 16);
  out.spriteMax = Math.round(number(s.spriteMax, 16, 0, 32));
  out.burstChance = number(s.burstChance, 0.12, 0, 1);
  out.randomOrder = s.randomOrder ?? false;
  out.jitter = s.jitter ?? false;
  out.color = /^#[0-9a-f]{6}$/i.test(s.color || "") ? s.color : DEFAULTS.color;
  out.repeats = {};
  out.empty = { ...DEFAULTS.empty };
  out.enabled = { ...DEFAULTS.enabled };
  for (const l of [...LAYERS, ...out.customLayers, ...Object.values(out.additionalLayers).flat()]) {
    const legacyLayer = Object.keys(REPEATED).find(key => REPEATED[key] === l);
    out.repeats[l] = Math.round(number(s.repeats?.[l], repeatDefaults[l] || 1, 1, 9));
    out.empty[l] = number(s.empty?.[l] ?? s.empty?.[legacyLayer], DEFAULTS.empty[l] ?? 0, 0, 1);
    out.enabled[l] = s.enabled?.[l] ?? s.enabled?.[legacyLayer] ?? DEFAULTS.enabled[l] ?? true;
  }
  return out;
}
export function rngFromSeed(seed) {
  let h = 2166136261;
  for (const c of String(seed)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(items, rng = Math.random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function gamma(shape, rng) {
  const d = shape - 1 / 3,
    c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const x =
      Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) *
      Math.cos(2 * Math.PI * rng());
    const v = (1 + c * x) ** 3;
    if (v <= 0) continue;
    const u = rng();
    if (
      u < 1 - 0.0331 * x ** 4 ||
      Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))
    )
      return d * v;
  }
}
export function density(rng) {
  const a = gamma(2.5, rng),
    b = gamma(2.5, rng);
  return (2 * a) / (a + b);
}
export function spriteCount(s, rng) {
  if (!s.spriteMax) return 0;
  if (rng() < s.burstChance)
    return Math.min(s.spriteMax, 8 + Math.floor(rng() * 9));
  const limit = Math.exp(-s.spriteMean);
  let n = 0,
    p = 1;
  do {
    n++;
    p *= rng();
  } while (p > limit);
  return Math.min(n - 1, s.spriteMax);
}
export function pickPlan(catalog, settings, seed) {
  const s = normalizeSettings(settings),
    rng = rngFromSeed(seed),
    mult = s.jitter ? density(rng) : 1;
  const excluded = new Set(s.disabledAssets);
  catalog = assetsForPack(catalog, s.pack).filter((a) => !excluded.has(a.id));
  const byLayer = Object.fromEntries(
    [...new Set(["background", ...activeLayers(s)])].map((l) => [
      l,
      catalog.filter((a) => a.layer === l),
    ]),
  );
  let order = activeLayers(s);
  if (s.randomOrder) order = ["background", ...shuffle(order.filter(l => l !== "background"), rng)];
  const ops = [];
  for (const layer of order) {
    const assets = byLayer[layer];
    if (!s.enabled[layer] || !assets.length) continue;
    const count = layer === "sprite" ? spriteCount(s, rng) : s.repeats[layer];
    for (let i = 0; i < count; i++) {
      if (rng() < Math.min(1, s.empty[layer] * (layer === "background" ? 1 : mult))) continue;
      const total = assets.reduce((n, a) => n + (a.weight ?? 1), 0);
      if (total <= 0) continue;
      let roll = rng() * total;
      const a =
        assets.find((a) => (roll -= a.weight ?? 1) < 0) || assets.at(-1);
      if (a.empty) continue;
      ops.push({
        assetId: a.id,
        layer,
        name: a.name,
        path: a.path,
        source: a.source,
        rx: rng(),
        ry: rng(),
        opacity: 1,
      });
    }
  }
  return {
    seed: String(seed),
    pack: s.pack,
    customLayers: s.customLayers,
    additionalLayers: s.additionalLayers,
    width: s.width,
    height: s.height,
    color: s.color,
    ops,
  };
}
export function metadata(card) {
  const counts = new Map(), totals = new Map();
  const labels = card.recipe.ops.map(op => categoryLabel(mergedLayer(op.layer)));
  for (const label of labels) totals.set(label, (totals.get(label) || 0) + 1);
  const attributes = card.recipe.ops.map((op,index) => {
    const label = labels[index], occurrence = (counts.get(label) || 0) + 1;
    counts.set(label, occurrence);
    return {trait_type: totals.get(label) > 1 ? `${label} ${occurrence}` : label, value:op.name};
  });
  return {
    name: card.name,
    description: "An independently generated painting.",
    image: `${card.id}.png`,
    attributes,
    properties: {
      generator: "NFT Painting Generator",
      version: 2,
      layer_order: "bottom-to-top",
      id: card.id,
      created: card.created,
      recipe: card.recipe,
    },
  };
}
export function validateCard(c) {
  if (
    !c ||
    typeof c.id !== "string" ||
    typeof c.name !== "string" ||
    !c.recipe ||
    !Array.isArray(c.recipe.ops) ||
    c.recipe.ops.length > 128
  )
    throw Error("Invalid painting in backup.");
  const r = c.recipe;
  if (
    !Number.isInteger(r.width) ||
    !Number.isInteger(r.height) ||
    r.width < 100 ||
    r.height < 100 ||
    r.width > 4096 ||
    r.height > 4096 ||
    !/^#[0-9a-f]{6}$/i.test(r.color)
  )
    throw Error("Invalid canvas in backup.");
  for (const o of r.ops)
    if (
      (!LAYERS.includes(o.layer) && !validCustomLayer(o.layer)) ||
      typeof o.assetId !== "string" ||
      typeof o.name !== "string" ||
      ![o.rx, o.ry, o.opacity].every(Number.isFinite) ||
      o.rx < 0 ||
      o.rx > 1 ||
      o.ry < 0 ||
      o.ry > 1 ||
      o.opacity < 0 ||
      o.opacity > 1
    )
      throw Error("Invalid layer in backup.");
  return c;
}
