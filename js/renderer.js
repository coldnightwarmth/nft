// Originals are decoded on demand; bound the cache instead of decoding a whole asset folder.
const images = new Map(),
  boxes = new Map();
export function clearImageCache() {
  for (const im of images.values()) im.close?.();
  images.clear();
  boxes.clear();
}
// Fetch independent layers concurrently, with bounded network and compressed-memory use.
const blobs = new Map(), pending = new Map(), waiters = [];
let fetching = 0, blobBytes = 0;
function discardBlob(key) {
  if (blobs.has(key)) { blobBytes -= blobs.get(key).size; blobs.delete(key); }
}
async function fetchAsset(asset) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(asset.url, {signal:controller.signal, cache:attempt ? "reload" : "default"});
      if (!response.ok) {
        const error = Error(`Could not load ${asset.name} (${response.status}).`);
        if (response.status >= 400 && response.status < 500 && ![408,429].includes(response.status)) {
          error.permanent = true;
        }
        throw error;
      }
      const blob = await response.blob();
      if (!blob.size) throw Error(`Empty image response for ${asset.name}.`);
      return blob;
    } catch (error) {
      lastError = error;
      if (error.permanent) throw error;
    } finally { clearTimeout(timeout); }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
  }
  throw Error(`Could not load ${asset.name} after 3 attempts. Please try again.`, {cause:lastError});
}
async function loadBlob(asset) {
  if (asset.file) return asset.file;
  const key = asset.url;
  if (blobs.has(key)) return blobs.get(key);
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    if (fetching >= 8) await new Promise(resolve => waiters.push(resolve));
    else fetching++;
    try {
      let blob;
      try { blob = await fetchAsset(asset); }
      catch (error) {
        if (!asset.originalUrl || asset.originalUrl === asset.url) throw error;
        blob = await fetchAsset({...asset, url:asset.originalUrl});
      }
      blobs.set(key, blob);
      blobBytes += blob.size;
      while (blobBytes > 64 * 1024 * 1024 && blobs.size > 1) {
        const oldest = blobs.keys().next().value;
        blobBytes -= blobs.get(oldest).size;
        blobs.delete(oldest);
      }
      return blob;
    } finally {
      if (waiters.length) waiters.shift()();
      else fetching--;
    }
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}
async function decode(asset, retry = true) {
  const cacheKey = asset.file ? asset.id : asset.url;
  if (images.has(cacheKey)) {
    const im = images.get(cacheKey);
    images.delete(cacheKey);
    images.set(cacheKey, im);
    return im;
  }
  const blob = await loadBlob(asset);
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
      if (!asset.file) {
        discardBlob(asset.url);
        if (retry) return decode(asset, false);
        if (asset.originalUrl && asset.originalUrl !== asset.url)
          return decode({...asset, url:asset.originalUrl}, false);
      }
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
  images.set(cacheKey, im);
  while (images.size > 24) {
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
export function prefetchRecipes(recipes, catalog) {
  const ids = new Set(recipes.flatMap(recipe => recipe.ops.map(op => op.assetId)));
  // Reuse the bounded eight-request queue and compressed cache, never decode in bulk.
  return Promise.all(catalog.filter(a => ids.has(a.id)).map(loadBlob));
}
export async function render(
  recipe,
  catalog,
  { width = 480, overlay = false, original = false, printCanvas = null } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.round((width * recipe.height) / recipe.width);
  const ctx = canvas.getContext("2d");
  let printContext;
  if (printCanvas) {
    printCanvas.width = canvas.width;
    printCanvas.height = canvas.height;
    printContext = printCanvas.getContext("2d");
  }
  const sx = canvas.width / recipe.width,
    sy = canvas.height / recipe.height;
  if (!overlay) {
    ctx.fillStyle = recipe.color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const lookup = new Map(catalog.map(a => [a.id, original && a.originalUrl ? { ...a, url: a.originalUrl } : a]));
  await Promise.all(recipe.ops.filter(op => !overlay || op.layer !== "background").map(op => {
    const asset = lookup.get(op.assetId);
    return asset ? loadBlob(asset) : Promise.resolve();
  }));
  for (const op of recipe.ops) {
    if (overlay && op.layer === "background") continue;
    const a = lookup.get(op.assetId);
    if (!a)
      throw Error(
        `Reconnect the asset folder containing “${op.name}” to edit or render this card.`,
      );
    const im = await decode(a);
    for (const ctx of printContext && op.layer !== "background" ? [canvas.getContext("2d"), printContext] : [canvas.getContext("2d")]) {
    ctx.globalAlpha = op.opacity ?? 1;
    ctx.globalCompositeOperation = op.blendMode || "source-over";
    if (op.placement === "sprite") {
      const box = bbox(im, a.id);
      if (!box) continue;
      const [x,y,w,h] = box;
      const dw = op.size * recipe.width * sx, dh = dw * h / w;
      const angle = (op.rotation || 0) * Math.PI / 180;
      const halfW = Math.min(canvas.width/2, (Math.abs(dw*Math.cos(angle))+Math.abs(dh*Math.sin(angle)))/2);
      const halfH = Math.min(canvas.height/2, (Math.abs(dw*Math.sin(angle))+Math.abs(dh*Math.cos(angle)))/2);
      ctx.save();
      ctx.translate(halfW+op.rx*Math.max(0,canvas.width-2*halfW),halfH+op.ry*Math.max(0,canvas.height-2*halfH));
      ctx.rotate(angle);
      ctx.drawImage(im,x,y,w,h,-dw/2,-dh/2,dw,dh);
      ctx.restore();
    } else if (op.layer === "sprite") {
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

export async function renderExports(recipe, catalog) {
  const print = document.createElement("canvas");
  let canvas;
  try {
    canvas = await render(recipe, catalog, {width:recipe.width, original:true, printCanvas:print});
    const [png, overlay] = await Promise.all([toBlob(canvas), toBlob(print)]);
    return {png, overlay};
  } finally {
    if (canvas) canvas.width = canvas.height = 0;
    print.width = print.height = 0;
  }
}
