const EFFECT_NAMES = {
  pixelation: "Pixelation",
  overlay: "Color overlay",
  blur: "Field blur",
  halftone: "Color halftone",
};

export function createGenerationMetadata(generation, { width, height, background, exportedAt }) {
  const filenames = generation.order.slice(0, generation.layerCount);
  if (generation.eye) filenames.push(generation.eye.filename);
  return {
    schemaVersion: 1,
    exportedAt,
    canvas: { width, height, background },
    layerOrder: "bottom-to-top",
    layerCount: filenames.length,
    dratiniLayerCount: generation.layerCount,
    layers: filenames.map((filename, index) => {
      const effect = generation.effects.get(filename);
      return {
        position: index + 1,
        filename,
        ...(index === generation.layerCount && generation.eye ? {
          role: "eyes", pack: generation.eye.pack, assetPath: generation.eye.assetPath,
        } : {}),
        effect: effect ? { type: effect.type, name: EFFECT_NAMES[effect.type], seed: effect.seed } : null,
      };
    }),
  };
}
