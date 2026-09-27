// Originals are decoded on demand; bound the cache instead of decoding a whole asset folder.
const images = new Map(),
  boxes = new Map();
export function clearImageCache() {
  for (const im of images.values()) im.close?.();
  images.clear();
  boxes.clear();
}
async function decode(asset) {
  if (images.has(asset.id)) {
    const im = images.get(asset.id);
    images.delete(asset.id);
    images.set(asset.id, im);
    return im;
  }
  const response = asset.file ? null : await fetch(asset.url);
  if (response && !response.ok)
    throw Error(`Could not load ${asset.name} (${response.status}).`);
  const blob = asset.file || (await response.blob());
  let im;
  try {
    im = await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      im = new Image();
      im.src = url;
      await im.decode();
    } catch {
      throw Error(
        `Could not decode “${asset.name}”. Check that it is a supported image.`,
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  if (im.width * im.height > 40_000_000) {
    im.close?.();
    throw Error(`${asset.name} exceeds the 40 megapixel image limit.`);
  }
  images.set(asset.id, im);
  while (images.size > 6) {
    const key = images.keys().next().value;
    images.get(key).close?.();
    images.delete(key);
  }
  return im;
}
function bbox(im, id) {
  if (boxes.has(id)) return boxes.get(id);
  const c = document.createElement("canvas");
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  let l = c.width,
    t = c.height,
    r = -1,
    b = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (data[(y * c.width + x) * 4 + 3]) {
        l = Math.min(l, x);
        r = Math.max(r, x);
        t = Math.min(t, y);
        b = Math.max(b, y);
      }
  const result = r < 0 ? null : [l, t, r - l + 1, b - t + 1];
  boxes.set(id, result);
  c.width = c.height = 0;
  return result;
}
export async function render(
  recipe,
  catalog,
  { width = 480, overlay = false } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * recipe.height) / recipe.width);
  const ctx = canvas.getContext("2d");
  const sx = canvas.width / recipe.width,
    sy = canvas.height / recipe.height;
  if (!overlay) {
    ctx.fillStyle = recipe.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const op of recipe.ops) {
    if (overlay && op.layer === "background") continue;
    const a = catalog.find((a) => a.id === op.assetId);
    if (!a)
      throw Error(
        `Reconnect the asset folder containing “${op.name}” to edit or render this card.`,
      );
    const im = await decode(a);
    ctx.globalAlpha = op.opacity ?? 1;
    if (op.layer === "sprite") {
      const box = bbox(im, a.id);
      if (!box) continue;
      const [x, y, w, h] = box;
      const dw = (w * recipe.width) / im.width,
        dh = (h * recipe.height) / im.height;
      ctx.drawImage(
        im,
        x,
        y,
        w,
        h,
        op.rx * Math.max(0, recipe.width - dw) * sx,
        op.ry * Math.max(0, recipe.height - dh) * sy,
        dw * sx,
        dh * sy,
      );
    } else ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalAlpha = 1;
  return canvas;
}
export const toBlob = (canvas, type = "image/png", quality) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b
          ? resolve(b)
          : reject(Error("The browser could not export this image.")),
      type,
      quality,
    ),
  );
export async function renderBlob(recipe, catalog, options) {
  const c = await render(recipe, catalog, options);
  const blob = await toBlob(c);
  c.width = c.height = 0;
  return blob;
}
