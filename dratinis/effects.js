export const EFFECT_TYPES = ["pixelation", "overlay", "blur", "halftone"];
export const HALFTONE_COLORS = ["#e53235", "#245eea", "#ebbf13", "#141414"];

export function chooseLayerEffect(settings, random = Math.random) {
  const enabled = EFFECT_TYPES.filter(type => settings.enabled.includes(type));
  const chance = Math.max(0, Math.min(100, Number(settings.chance) || 0));
  if (!enabled.length || chance === 0 || random() * 100 >= chance) return null;
  return Object.freeze({
    type: enabled[Math.floor(random() * enabled.length)],
    seed: Math.floor(random() * 0x100000000),
  });
}

export function planLayerEffects(filenames, settings, existing = new Map(), random = Math.random) {
  const planned = new Map(existing);
  for (const filename of filenames) {
    if (!planned.has(filename)) planned.set(filename, chooseLayerEffect(settings, random));
  }
  return planned;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
}

function surface(width, height, readFrequently = false) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return { canvas, context: canvas.getContext("2d", { willReadFrequently: readFrequently }) };
}

function clear({ canvas, context }) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  context.imageSmoothingEnabled = true;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function sampleVisiblePixel(image, random) {
  const { data, width } = image;
  let index = -1;
  for (let attempt = 0; attempt < 256; attempt++) {
    const candidate = Math.floor(random() * data.length / 4) * 4;
    if (data[candidate + 3] >= 64) { index = candidate; break; }
  }
  if (index < 0) {
    for (let candidate = 0; candidate < data.length; candidate += 4) {
      if (data[candidate + 3] > 0) { index = candidate; break; }
    }
  }
  if (index < 0) return null;
  return {
    x: index / 4 % width,
    y: Math.floor(index / 4 / width),
    color: `rgb(${data[index]}, ${data[index + 1]}, ${data[index + 2]})`,
  };
}

// Scratch canvases are reused, so processing a large stack doesn't retain a
// full-resolution bitmap for every effect. Each recipe's seed makes it repeatable.
export function createEffectRenderer(width, height) {
  let buffers;
  function draw(destination, bitmap, recipe) {
    if (!recipe || !EFFECT_TYPES.includes(recipe.type)) {
      destination.drawImage(bitmap, 0, 0, width, height);
      return;
    }
    buffers ??= {
      output: surface(width, height),
      original: surface(width, height, true),
      mask: surface(width, height),
      detail: surface(width, height),
      small: surface(1, 1, true),
    };
    const { output, original, mask, detail, small } = buffers;
    const context = output.context;
    const random = seededRandom(recipe.seed);
    clear(output);

    if (recipe.type === "pixelation") {
      const block = 8 + Math.floor(random() * 11);
      small.canvas.width = Math.ceil(width / block);
      small.canvas.height = Math.ceil(height / block);
      small.context.drawImage(bitmap, 0, 0, small.canvas.width, small.canvas.height);
      context.imageSmoothingEnabled = false;
      context.drawImage(small.canvas, 0, 0, width, height);
    } else if (recipe.type === "overlay" || recipe.type === "blur") {
      clear(original);
      original.context.drawImage(bitmap, 0, 0, width, height);
      const sample = sampleVisiblePixel(original.context.getImageData(0, 0, width, height), random);
      if (!sample) {
        destination.drawImage(bitmap, 0, 0, width, height);
        return;
      }
      if (recipe.type === "overlay") {
        context.drawImage(original.canvas, 0, 0);
        context.globalCompositeOperation = "source-atop";
        context.globalAlpha = 0.72;
        context.fillStyle = sample.color;
        context.fillRect(0, 0, width, height);
      } else {
        // Blend a sharp focus area into a blurred field. Complementary masks
        // and additive compositing preserve alpha instead of doubling opacity.
        clear(mask);
        const radius = Math.min(width, height) * (0.28 + random() * 0.20);
        const gradient = mask.context.createRadialGradient(sample.x, sample.y, radius * 0.12, sample.x, sample.y, radius);
        gradient.addColorStop(0, "rgba(255,255,255,1)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        mask.context.fillStyle = gradient;
        mask.context.fillRect(0, 0, width, height);
        context.filter = `blur(${10 + random() * 12}px)`;
        context.drawImage(original.canvas, 0, 0);
        context.filter = "none";
        context.globalCompositeOperation = "destination-out";
        context.drawImage(mask.canvas, 0, 0);
        clear(detail);
        detail.context.drawImage(original.canvas, 0, 0);
        detail.context.globalCompositeOperation = "destination-in";
        detail.context.drawImage(mask.canvas, 0, 0);
        context.globalCompositeOperation = "lighter";
        context.drawImage(detail.canvas, 0, 0);
      }
    } else if (recipe.type === "halftone") {
      const ink = HALFTONE_COLORS[Math.floor(random() * HALFTONE_COLORS.length)];
      const cell = 8 + Math.floor(random() * 7);
      const columns = Math.ceil(width / cell);
      const rows = Math.ceil(height / cell);
      small.canvas.width = columns;
      small.canvas.height = rows;
      small.context.drawImage(bitmap, 0, 0, columns, rows);
      const pixels = small.context.getImageData(0, 0, columns, rows).data;
      const cellWidth = width / columns;
      const cellHeight = height / rows;
      context.fillStyle = ink;
      context.beginPath();
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const index = (y * columns + x) * 4;
          if (pixels[index + 3] < 8) continue;
          const light = (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255;
          const radius = Math.min(cellWidth, cellHeight) * 0.55 * Math.sqrt(0.10 + 0.82 * (1 - light));
          const cx = (x + 0.5) * cellWidth;
          const cy = (y + 0.5) * cellHeight;
          context.moveTo(cx + radius, cy);
          context.arc(cx, cy, radius, 0, Math.PI * 2);
        }
      }
      context.fill();
      context.globalCompositeOperation = "destination-in";
      context.drawImage(bitmap, 0, 0, width, height);
    }
    destination.drawImage(output.canvas, 0, 0);
  }
  return { draw };
}
