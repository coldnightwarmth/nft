const EFFECT_NAMES = {
  pixelation: "Pixelation",
  overlay: "Color overlay",
  blur: "Field blur",
  halftone: "Color halftone",
};

export function createGenerationMetadata(generation, { width, height, background, exportedAt }) {
  return {
    schemaVersion: 1,
    exportedAt,
    canvas: { width, height, background },
    layerOrder: "bottom-to-top",
    layerCount: generation.layerCount,
    layers: generation.order.slice(0, generation.layerCount).map((filename, index) => {
      const effect = generation.effects.get(filename);
      return {
        position: index + 1,
        filename,
        effect: effect ? { type: effect.type, name: EFFECT_NAMES[effect.type], seed: effect.seed } : null,
      };
    }),
  };
}
