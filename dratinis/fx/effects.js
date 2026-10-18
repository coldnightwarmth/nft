export const EFFECTS = [
  ["chromatic", "Chromatic split", "Offset color channels into red, green and blue fringes."],
  ["posterize", "Posterize", "Reduce the layer to a few bold color levels."],
  ["duotone", "Duotone", "Map shadows and highlights to a contrasting color pair."],
  ["negative", "Negative", "Invert the colors and retain the transparent background."],
  ["solarize", "Solarize", "Invert brighter tones for a psychedelic photographic finish."],
  ["stencil", "Stencil", "Flatten the artwork into two crisp, contrasting tones."],
  ["dither", "Ordered dithering", "Rebuild limited colors with a retro checkerboard pattern."],
  ["engraving", "Engraving", "Replace shading with fine, crossing hatch marks."],
  ["ascii", "ASCII art", "Draw the layer with a field of colored letters and symbols."],
  ["neon", "Neon edges", "Illuminate the outlines and details with a colored glow."],
  ["chrome", "Chrome", "Turn the shading into bands of reflective liquid metal."],
  ["emboss", "Emboss", "Press the details into a raised, sculpted surface."],
  ["paper", "Paper cutout", "Stack flat tonal shapes with small paper-like shadows."],
  ["kaleidoscope", "Kaleidoscope", "Reflect wedges of the layer into a radial pattern."],
  ["swirl", "Swirl", "Twist the artwork around a center point."],
  ["wave", "Wave distortion", "Bend the layer into frozen horizontal and vertical ripples."],
  ["glitch", "Glitch slices", "Displace narrow strips like a corrupted digital image."],
  ["glass", "Shattered glass", "Separate the artwork into shifted, angular fragments."],
  ["distress", "Distressed print", "Wear away small flecks, scratches and patches of ink."],
  ["echo", "Ghost echoes", "Trail translucent, offset copies behind the original layer."],
].map(([id, name, description]) => ({ id, name, description }));

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x100000000;
  };
}

export function sampleLayers(images, count = 4, random = Math.random) {
  const pool = [...images];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

const clamp = (n, low = 0, high = 255) => Math.min(high, Math.max(low, n));
const mix = (a, b, t) => a + (b - a) * t;
const PAIRS = [
  [[35, 23, 85], [255, 158, 154]], [[13, 50, 72], [255, 221, 86]],
  [[78, 20, 60], [149, 246, 196]], [[38, 28, 31], [255, 112, 46]],
  [[20, 46, 112], [235, 207, 255]], [[55, 36, 98], [138, 238, 255]],
];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const rgb = c => `rgb(${c.map(Math.round).join(",")})`;

function surface(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  return canvas;
}

export function prepareSource(image, width = 466, height = 503) {
  const canvas = surface(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const light = new Float32Array(width * height);
  let left = width, top = height, right = 0, bottom = 0;
  for (let i = 0; i < light.length; i++) {
    const p = i * 4;
    light[i] = (pixels.data[p] * .2126 + pixels.data[p + 1] * .7152 + pixels.data[p + 2] * .0722) / 255;
    if (pixels.data[p + 3] > 20) {
      const x = i % width, y = Math.floor(i / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  const center = left <= right ? { x: (left + right) / 2, y: (top + bottom) / 2 } : { x: width / 2, y: height / 2 };
  return { canvas, pixels, light, width, height, center };
}

// Pixel operations retain the original alpha. Geometry operations resample it
// along with color, so the results remain usable as transparent layer effects.
export function transformPixels(input, light, width, height, type, seed) {
  const result = new Uint8ClampedArray(input.length);
  const random = seededRandom(seed);
  const pair = PAIRS[Math.floor(random() * PAIRS.length)];
  const levels = 3 + Math.floor(random() * 3);
  const threshold = .42 + random() * .18;
  const spacing = Math.max(3, width / 932 * 9);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x, p = i * 4, l = light[i];
      if (!input[p + 3]) continue;
      let r = input[p], g = input[p + 1], b = input[p + 2];
      if (type === "posterize") {
        const step = 255 / (levels - 1);
        r = Math.round(r / step) * step; g = Math.round(g / step) * step; b = Math.round(b / step) * step;
      } else if (type === "duotone" || type === "stencil") {
        const t = type === "stencil" ? Number(l >= threshold) : clamp((l - .12) / .8, 0, 1);
        [r, g, b] = pair[0].map((v, c) => mix(v, pair[1][c], t));
      } else if (type === "negative") {
        r = 255 - r; g = 255 - g; b = 255 - b;
      } else if (type === "solarize") {
        const t = threshold * 255;
        r = r > t ? 255 - r : r; g = g > t ? 255 - g : g; b = b > t ? 255 - b : b;
      } else if (type === "dither") {
        const cell = Math.max(1, Math.round(width / 466));
        const t = (BAYER[(Math.floor(y / cell) % 4) * 4 + Math.floor(x / cell) % 4] + .5) / 16 - .5;
        r = Math.round(clamp(r / 255 * 2 + t, 0, 2)) * 127.5;
        g = Math.round(clamp(g / 255 * 2 + t, 0, 2)) * 127.5;
        b = Math.round(clamp(b / 255 * 2 + t, 0, 2)) * 127.5;
      } else if (type === "engraving") {
        const line = (x + y) % spacing < spacing * (.1 + (1 - l) * .45);
        const cross = l < .48 && (x - y + height * spacing) % spacing < spacing * .19;
        [r, g, b] = line || cross ? [30, 32, 48] : [244, 231, 205];
      } else if (type === "emboss" || type === "chrome") {
        const sample = (dx, dy) => {
          const j = clamp(y + dy, 0, height - 1) * width + clamp(x + dx, 0, width - 1);
          return input[j * 4 + 3] ? light[j] : l;
        };
        const distance = Math.max(1, Math.round(width / 466));
        const relief = sample(-distance, -distance) - sample(distance, distance);
        if (type === "emboss") {
          r = g = b = clamp(142 + relief * 480);
        } else {
          const shine = (Math.sin(l * 24 + relief * 8 + y / height * 3) + 1) / 2;
          const stops = [[12, 19, 36], [76, 100, 130], [235, 247, 255], [255, 255, 255]];
          const t = shine * 3, j = Math.min(2, Math.floor(t));
          [r, g, b] = stops[j].map((v, c) => mix(v, stops[j + 1][c], t - j));
        }
      }
      result[p] = r; result[p + 1] = g; result[p + 2] = b; result[p + 3] = input[p + 3];
    }
  }
  return result;
}

function putPixels(context, data, width, height) {
  const image = context.createImageData(width, height);
  image.data.set(data); context.putImageData(image, 0, 0);
}

function resample(source, map) {
  const { pixels: { data }, width, height } = source;
  const output = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [sx, sy] = map(x, y);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    const p = (y * width + x) * 4;
    let alpha = 0, red = 0, green = 0, blue = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const px = x0 + dx, py = y0 + dy;
      if (px < 0 || px >= width || py < 0 || py >= height) continue;
      const q = (py * width + px) * 4;
      const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * data[q + 3];
      alpha += weight; red += data[q] * weight; green += data[q + 1] * weight; blue += data[q + 2] * weight;
    }
    if (alpha > 0) {
      output[p] = red / alpha; output[p + 1] = green / alpha; output[p + 2] = blue / alpha; output[p + 3] = alpha;
    }
  }
  return output;
}

export function waveCoordinates(x, y, width, height, phase) {
  // Broad bends with roughly five times the old displacement.
  return [
    x + Math.sin(y / height * 11 + phase) * width * .18,
    y + Math.sin(x / width * 8 + phase) * height * .10,
  ];
}

export function renderEffect(source, type, seed = 1) {
  const { canvas, pixels: { data }, light, width: w, height: h, center } = source;
  const output = surface(w, h), ctx = output.getContext("2d");
  const random = seededRandom(seed), scale = w / 932;
  if (type === "original") { ctx.drawImage(canvas, 0, 0); return output; }
  if (!EFFECTS.some(effect => effect.id === type)) throw new Error(`Unknown effect: ${type}`);
  if (["posterize", "duotone", "negative", "solarize", "stencil", "dither", "engraving", "emboss", "chrome"].includes(type)) {
    putPixels(ctx, transformPixels(data, light, w, h, type, seed), w, h);
  } else if (type === "chromatic") {
    const shift = Math.max(2, Math.round((10 + random() * 15) * scale));
    const result = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const offsets = [x - shift, x, x + shift];
      const alpha = offsets.map(sx => sx < 0 || sx >= w ? 0 : data[(y * w + sx) * 4 + 3]);
      const maxAlpha = Math.max(...alpha);
      for (let c = 0; c < 3; c++) result[p + c] = maxAlpha && alpha[c] ? data[(y * w + offsets[c]) * 4 + c] * alpha[c] / maxAlpha : 0;
      result[p + 3] = maxAlpha;
    }
    putPixels(ctx, result, w, h);
  } else if (type === "ascii") {
    const cell = Math.max(4, Math.round(14 * scale));
    const chars = "@%#*+=-:.";
    ctx.font = `bold ${cell * 1.18}px monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let y = cell / 2; y < h; y += cell) for (let x = cell / 2; x < w; x += cell) {
      const i = Math.floor(y) * w + Math.floor(x), p = i * 4;
      if (data[p + 3] < 30) continue;
      ctx.fillStyle = rgb([data[p] * .8, data[p + 1] * .8, data[p + 2] * .8]);
      ctx.fillText(chars[Math.min(chars.length - 1, Math.floor(light[i] * chars.length))], x, y);
    }
    ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(canvas, 0, 0);
  } else if (type === "neon") {
    const ink = [[255, 60, 177], [72, 234, 255], [162, 255, 74], [180, 127, 255]][Math.floor(random() * 4)];
    const result = new Uint8ClampedArray(data.length);
    const distance = Math.max(1, Math.round(2 * scale));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!data[p + 3]) continue;
      let edge = 0;
      for (const [dx, dy] of [[-distance, 0], [distance, 0], [0, -distance], [0, distance]]) {
        const sx = x + dx, sy = y + dy;
        const q = sy * w + sx;
        const l = sx < 0 || sx >= w || sy < 0 || sy >= h || !data[q * 4 + 3] ? 0 : light[q];
        edge = Math.max(edge, Math.abs(light[y * w + x] - l));
      }
      const glow = clamp(edge * 5, 0, 1);
      for (let c = 0; c < 3; c++) result[p + c] = mix(12, ink[c], glow);
      result[p + 3] = data[p + 3];
    }
    const edges = surface(w, h); putPixels(edges.getContext("2d"), result, w, h);
    ctx.drawImage(edges, 0, 0); ctx.globalCompositeOperation = "screen";
    ctx.filter = `blur(${6 * scale}px)`; ctx.drawImage(edges, 0, 0); ctx.filter = "none";
    ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(canvas, 0, 0);
    edges.width = edges.height = 1;
  } else if (type === "paper") {
    const palette = [[34, 53, 94], [92, 129, 165], [156, 189, 203], [242, 179, 181], [255, 229, 183]];
    if (random() > .5) palette.splice(1, 3, [102, 76, 136], [197, 119, 149], [238, 181, 147]);
    for (let band = 0; band < palette.length; band++) {
      const mask = surface(w, h), maskCtx = mask.getContext("2d");
      const result = new Uint8ClampedArray(data.length);
      for (let i = 0; i < light.length; i++) if (light[i] >= band / palette.length) {
        result.set(palette[band], i * 4); result[i * 4 + 3] = data[i * 4 + 3];
      }
      putPixels(maskCtx, result, w, h);
      ctx.shadowColor = "#0a152da0"; ctx.shadowBlur = 3 * scale;
      ctx.shadowOffsetX = 2 * scale; ctx.shadowOffsetY = 5 * scale;
      ctx.drawImage(mask, 0, 0);
      mask.width = mask.height = 1;
    }
    ctx.shadowColor = "transparent"; ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(canvas, 0, 0);
  } else if (["kaleidoscope", "swirl", "wave"].includes(type)) {
    const phase = random() * Math.PI * 2, direction = random() > .5 ? 1 : -1;
    const cx = center.x, cy = center.y, radius = Math.max(w, h) * .57;
    const segment = Math.PI / (3 + Math.floor(random() * 4));
    const mapper = type === "wave" ? (x, y) => waveCoordinates(x, y, w, h, phase) : (x, y) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
      let angle = Math.atan2(dy, dx);
      if (type === "swirl") angle += direction * 3.8 * Math.max(0, 1 - r / radius) ** 2;
      else { angle = ((angle + phase) % (segment * 2) + segment * 2) % (segment * 2); if (angle > segment) angle = segment * 2 - angle; angle += phase; }
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
    };
    putPixels(ctx, resample(source, mapper), w, h);
  } else if (type === "glitch") {
    ctx.drawImage(canvas, 0, 0);
    for (let i = 0; i < 24; i++) {
      const y = Math.floor(random() * h), height = Math.max(1, Math.min(h - y, (5 + random() * 30) * scale));
      const shift = (random() - .5) * w * .18;
      ctx.clearRect(0, y, w, height); ctx.drawImage(canvas, 0, y, w, height, shift, y, w, height);
    }
  } else if (type === "glass") {
    const cols = 6, rows = 7;
    const points = Array.from({ length: rows + 1 }, (_, y) => Array.from({ length: cols + 1 }, (_, x) => ({
      x: x * w / cols + (x > 0 && x < cols ? (random() - .5) * w / cols * .6 : 0),
      y: y * h / rows + (y > 0 && y < rows ? (random() - .5) * h / rows * .6 : 0),
    })));
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const a = points[y][x], b = points[y][x + 1], c = points[y + 1][x + 1], d = points[y + 1][x];
      for (const triangle of [[a, b, c], [a, c, d]]) {
        const cx = triangle.reduce((n, p) => n + p.x, 0) / 3, cy = triangle.reduce((n, p) => n + p.y, 0) / 3;
        ctx.save(); ctx.translate(cx + (random() - .5) * w * .035, cy + (random() - .5) * h * .035);
        ctx.rotate((random() - .5) * .18); ctx.scale(.94, .94); ctx.translate(-cx, -cy);
        ctx.beginPath(); triangle.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.closePath(); ctx.clip(); ctx.drawImage(canvas, 0, 0); ctx.restore();
      }
    }
  } else if (type === "distress") {
    ctx.drawImage(canvas, 0, 0); ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 1400; i++) {
      ctx.globalAlpha = .35 + random() * .65;
      const x = random() * w, y = random() * h, radius = (1 + random() ** 3 * 9) * scale;
      ctx.beginPath(); ctx.ellipse(x, y, radius, radius * (.25 + random()), random() * Math.PI, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = Math.max(.5, scale);
    for (let i = 0; i < 65; i++) {
      const x = random() * w, y = random() * h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 50 * scale, y + random() * 90 * scale); ctx.stroke();
    }
  } else if (type === "echo") {
    const angle = random() * Math.PI * 2;
    const dx = Math.cos(angle) * 22 * scale, dy = Math.sin(angle) * 22 * scale;
    for (let i = 4; i > 0; i--) { ctx.globalAlpha = .10 + (4 - i) * .06; ctx.drawImage(canvas, dx * i, dy * i); }
    ctx.globalAlpha = 1; ctx.drawImage(canvas, 0, 0);
  }
  return output;
}
