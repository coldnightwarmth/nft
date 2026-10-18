import { createEffectRenderer, planLayerEffects } from "./effects.js?v=1";
import { createGenerationMetadata } from "./metadata.js?v=1";
import { createFavorites } from "./favorites.js?v=1";

const canvas = document.querySelector("#canvas");
const context = canvas.getContext("2d");
const slider = document.querySelector("#layers");
const count = document.querySelector("#layer-count");
const background = document.querySelector("#background");
const regenerate = document.querySelector("#regenerate");
const reorder = document.querySelector("#reorder");
const shuffleEffects = document.querySelector("#shuffle-effects");
const download = document.querySelector("#download");
const status = document.querySelector("#status");
const viewport = document.querySelector("#viewport");
const zoomOut = document.querySelector("#zoom-out");
const zoomIn = document.querySelector("#zoom-in");
const zoomReset = document.querySelector("#zoom-reset");
const effectsButton = document.querySelector("#effects-button");
const effectsControl = document.querySelector(".effects-control");
const effectsPanel = document.querySelector("#effects-panel");
const effectToggles = [...document.querySelectorAll("[data-effect]")];
const effectChance = document.querySelector("#effect-chance");
const effectChanceValue = document.querySelector("#effect-chance-value");
const effectRenderer = createEffectRenderer(canvas.width, canvas.height);
const assetsURL = new URL("./assets/", import.meta.url);
const foreground = document.createElement("canvas");
foreground.width = canvas.width;
foreground.height = canvas.height;
let images = [];
let order = [];
let layerEffects = new Map();
let activeRender;
let debounce;
let hasRendered = false;
let exporting = false;
const generationHistory = [];
const historyLimit = 10;
let currentGeneration = null;
let favorites;
// Keep compressed files in memory, and decode only one layer at a time.
const blobs = new Map();
let zoom = 1;
let fitWidth = 0;
let fitHeight = 0;
const pan = { x: 0, y: 0 };
const pointers = new Map();

function readEffectSettings() {
  return {
    enabled: effectToggles.filter(input => input.checked).map(input => input.dataset.effect),
    chance: Number(effectChance.value),
  };
}

function updateEffectControls() {
  const settings = readEffectSettings();
  effectChanceValue.value = `${settings.chance}%`;
  effectChance.setAttribute("aria-valuetext", `${settings.chance}% chance per layer`);
  effectsButton.classList.toggle("has-effects", settings.enabled.length > 0 && settings.chance > 0);
  effectsButton.title = `Layer effects · ${settings.enabled.length} enabled · ${settings.chance}% chance per layer`;
}

function positionEffectsPanel() {
  if (effectsPanel.hidden) return;
  const anchor = effectsButton.getBoundingClientRect();
  effectsPanel.style.maxHeight = `${Math.max(80, anchor.top - 20)}px`;
  const panel = effectsPanel.getBoundingClientRect();
  const left = Math.max(12, Math.min(anchor.left + anchor.width / 2 - panel.width / 2, document.documentElement.clientWidth - panel.width - 12));
  effectsPanel.style.left = `${left}px`;
  effectsPanel.style.top = `${Math.max(8, anchor.top - panel.height - 8)}px`;
}

function closeEffectsPanel(restoreFocus = false) {
  effectsPanel.hidden = true;
  effectsButton.setAttribute("aria-expanded", "false");
  if (restoreFocus) effectsButton.focus();
}

effectsButton.addEventListener("click", () => {
  if (!effectsPanel.hidden) return closeEffectsPanel(true);
  favorites?.close();
  effectsPanel.hidden = false;
  effectsButton.setAttribute("aria-expanded", "true");
  positionEffectsPanel();
  effectToggles[0].focus();
});
document.querySelector("#effects-close").addEventListener("click", () => closeEffectsPanel(true));
document.addEventListener("pointerdown", event => {
  if (!effectsPanel.hidden && !effectsControl.contains(event.target)) closeEffectsPanel();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !effectsPanel.hidden) {
    event.preventDefault();
    closeEffectsPanel(true);
  }
});
for (const input of effectToggles) input.addEventListener("change", updateEffectControls);
effectChance.addEventListener("input", updateEffectControls);
window.addEventListener("resize", positionEffectsPanel);

function updateView() {
  const limitX = Math.max(0, (fitWidth * zoom - viewport.clientWidth) / 2);
  const limitY = Math.max(0, (fitHeight * zoom - viewport.clientHeight) / 2);
  pan.x = Math.max(-limitX, Math.min(limitX, pan.x));
  pan.y = Math.max(-limitY, Math.min(limitY, pan.y));
  canvas.style.transform = `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomReset.textContent = `${Math.round(zoom * 100)}%`;
  zoomOut.disabled = zoom <= 0.25;
  zoomIn.disabled = zoom >= 5;
  viewport.classList.toggle("zoomed", zoom > 1);
}

function setZoom(value, anchor = { x: 0, y: 0 }) {
  const next = Math.max(0.25, Math.min(5, value));
  const ratio = next / zoom;
  pan.x = anchor.x - (anchor.x - pan.x) * ratio;
  pan.y = anchor.y - (anchor.y - pan.y) * ratio;
  zoom = next;
  updateView();
}

function fitCanvas() {
  const scale = Math.min(
    Math.max(1, viewport.clientWidth - 16) / canvas.width,
    Math.max(1, viewport.clientHeight - 16) / canvas.height,
  );
  fitWidth = canvas.width * scale;
  fitHeight = canvas.height * scale;
  canvas.style.width = `${fitWidth}px`;
  canvas.style.height = `${fitHeight}px`;
  updateView();
}

function localPoint(point) {
  const rect = viewport.getBoundingClientRect();
  return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
}

zoomOut.addEventListener("click", () => setZoom(Math.round(zoom * 100 - 25) / 100));
zoomIn.addEventListener("click", () => setZoom(Math.round(zoom * 100 + 25) / 100));
zoomReset.addEventListener("click", () => setZoom(1));
viewport.addEventListener("dblclick", () => setZoom(1));
viewport.addEventListener("wheel", event => {
  event.preventDefault();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
  setZoom(zoom * Math.exp(-event.deltaY * unit * 0.002), localPoint({ x: event.clientX, y: event.clientY }));
}, { passive: false });

viewport.addEventListener("pointerdown", event => {
  if (event.button !== 0 || pointers.size >= 2) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  viewport.setPointerCapture(event.pointerId);
  viewport.classList.add("dragging");
});

viewport.addEventListener("pointermove", event => {
  if (!pointers.has(event.pointerId)) return;
  const previous = [...pointers.values()];
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  const current = [...pointers.values()];
  if (current.length === 2) {
    const midpoint = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
    const distance = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
    const before = midpoint(previous);
    const after = midpoint(current);
    if (distance(previous) > 0) setZoom(zoom * distance(current) / distance(previous), localPoint(before));
    pan.x += after.x - before.x;
    pan.y += after.y - before.y;
  } else {
    pan.x += current[0].x - previous[0].x;
    pan.y += current[0].y - previous[0].y;
  }
  updateView();
});

function releasePointer(event) {
  pointers.delete(event.pointerId);
  viewport.classList.toggle("dragging", pointers.size > 0);
}
viewport.addEventListener("pointerup", releasePointer);
viewport.addEventListener("pointercancel", releasePointer);
viewport.addEventListener("lostpointercapture", releasePointer);
new ResizeObserver(fitCanvas).observe(viewport);

function shuffled(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function paint() {
  context.fillStyle = background.value;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(foreground, 0, 0);
  document.documentElement.style.setProperty("--background", background.value);
  document.querySelector('meta[name="theme-color"]').content = background.value;
  favorites?.update();
}

function updateHistoryHint() {
  const available = generationHistory.length;
  const undoHint = `Right-click to go back (${available} available)`;
  regenerate.title = `Regenerate · ${undoHint}`;
  reorder.title = `${currentGeneration?.layerCount === 1 ? "Reorder needs at least 2 layers" : "Shuffle the current layers’ stacking order"} · ${undoHint}`;
  shuffleEffects.title = `Reroll effects on the same layers, keeping their stacking order · ${undoHint}`;
  // Keep right-click undo available even when a single layer cannot be reordered.
  reorder.disabled = !currentGeneration || (currentGeneration.layerCount < 2 && available === 0);
}

function rememberGeneration() {
  if (!currentGeneration) return;
  const snapshot = document.createElement("canvas");
  snapshot.width = foreground.width;
  snapshot.height = foreground.height;
  snapshot.getContext("2d").drawImage(foreground, 0, 0);
  generationHistory.push({
    ...currentGeneration,
    background: background.value,
    foreground: snapshot,
  });
  if (generationHistory.length > historyLimit) generationHistory.shift();
}

function previousGeneration(event) {
  event.preventDefault();
  if (!generationHistory.length) return;
  clearTimeout(debounce);
  activeRender?.abort();
  activeRender = null;
  const previous = generationHistory.pop();
  order = [...previous.order];
  layerEffects = new Map(previous.effects);
  slider.value = previous.layerCount;
  count.value = slider.value;
  background.value = previous.background;
  const target = foreground.getContext("2d");
  target.clearRect(0, 0, foreground.width, foreground.height);
  target.drawImage(previous.foreground, 0, 0);
  currentGeneration = { order: [...order], layerCount: previous.layerCount, effects: layerEffects };
  paint();
  canvas.setAttribute("aria-label", `${previous.layerCount} randomly layered Dratinis`);
  canvas.setAttribute("aria-busy", "false");
  status.className = "sr-only";
  status.textContent = `Previous generation restored. ${generationHistory.length} earlier generations available.`;
  updateHistoryHint();
}

async function recallFavorite(load) {
  clearTimeout(debounce);
  activeRender?.abort();
  const controller = new AbortController();
  activeRender = controller;
  canvas.setAttribute("aria-busy", "true");
  status.className = "sr-only";
  status.textContent = "Recalling favorite…";
  try {
    const saved = await load();
    controller.signal.throwIfAborted();
    if (!saved) throw Error("This favorite is no longer available.");
    const bitmap = await createImageBitmap(saved.foreground);
    try {
      controller.signal.throwIfAborted();
      rememberGeneration();
      const selected = saved.metadata.layers.map(layer => layer.filename);
      const selectedSet = new Set(selected);
      order = [...selected, ...shuffled(images.filter(filename => !selectedSet.has(filename)))];
      layerEffects = new Map(saved.metadata.layers.map(({ filename, effect }) => [filename, effect ? Object.freeze({ type: effect.type, seed: effect.seed }) : null]));
      slider.value = selected.length;
      count.value = slider.value;
      background.value = saved.metadata.canvas.background;
      const target = foreground.getContext("2d");
      target.clearRect(0, 0, foreground.width, foreground.height);
      target.drawImage(bitmap, 0, 0);
      currentGeneration = { order: [...order], layerCount: selected.length, effects: layerEffects };
      hasRendered = true;
      shuffleEffects.disabled = false;
      download.disabled = exporting;
      paint();
      updateHistoryHint();
      canvas.setAttribute("aria-label", `${selected.length} randomly layered Dratinis`);
      status.textContent = "Favorite recalled.";
      return true;
    } finally { bitmap.close(); }
  } catch (error) {
    if (controller.signal.aborted) return false;
    throw error;
  } finally {
    if (activeRender === controller) canvas.setAttribute("aria-busy", "false");
  }
}

async function render() {
  activeRender?.abort();
  const controller = new AbortController();
  activeRender = controller;
  const renderOrder = [...order];
  const selected = renderOrder.slice(0, Number(slider.value));
  const renderEffects = planLayerEffects(selected, readEffectSettings(), layerEffects);
  const draft = document.createElement("canvas");
  draft.width = canvas.width;
  draft.height = canvas.height;
  const drawing = draft.getContext("2d");
  canvas.setAttribute("aria-busy", "true");
  status.className = "sr-only";
  status.textContent = "Generating Dratinis…";

  try {
    for (const filename of selected) {
      controller.signal.throwIfAborted();
      let blob = blobs.get(filename);
      if (!blob) {
        const response = await fetch(new URL(filename, assetsURL), { signal: controller.signal });
        if (!response.ok) throw new Error(`Unable to load ${filename}`);
        blob = await response.blob();
        blobs.set(filename, blob);
      }
      const bitmap = await createImageBitmap(blob);
      try {
        controller.signal.throwIfAborted();
        effectRenderer.draw(drawing, bitmap, renderEffects.get(filename));
      } finally {
        bitmap.close();
      }
    }
    controller.signal.throwIfAborted();
    rememberGeneration();
    const target = foreground.getContext("2d");
    target.clearRect(0, 0, foreground.width, foreground.height);
    target.drawImage(draft, 0, 0);
    layerEffects = renderEffects;
    currentGeneration = { order: renderOrder, layerCount: selected.length, effects: renderEffects };
    updateHistoryHint();
    shuffleEffects.disabled = false;
    paint();
    hasRendered = true;
    download.disabled = exporting;
    canvas.setAttribute("aria-label", `${selected.length} randomly layered Dratinis`);
    status.textContent = `${selected.length} Dratini layers generated.`;
  } catch (error) {
    if (controller.signal.aborted) return;
    status.className = "error";
    status.textContent = "Some Dratinis couldn’t load. Press Regenerate to try again.";
    console.error(error);
  } finally {
    if (activeRender === controller) canvas.setAttribute("aria-busy", "false");
  }
}

async function initialize() {
  try {
    const response = await fetch(new URL("manifest.json", assetsURL), { cache: "no-cache" });
    if (!response.ok) throw new Error("Unable to load Dratini library");
    const manifest = await response.json();
    if (!manifest.images?.length) throw new Error("The Dratini library is empty");
    images = manifest.images;
    slider.max = Math.min(99, images.length);
    slider.value = Math.min(Number(slider.value), Number(slider.max));
    count.value = slider.value;
    slider.disabled = false;
    order = shuffled(images);
    await render();
  } catch (error) {
    status.className = "error";
    status.textContent = "The Dratini library couldn’t load. Press Regenerate to retry.";
    console.error(error);
  } finally {
    regenerate.disabled = false;
  }
}

slider.addEventListener("input", () => {
  count.value = slider.value;
  activeRender?.abort();
  clearTimeout(debounce);
  debounce = setTimeout(render, 75);
});

background.addEventListener("input", paint);

regenerate.addEventListener("click", () => {
  clearTimeout(debounce);
  if (!images.length) {
    regenerate.disabled = true;
    initialize();
    return;
  }
  order = shuffled(images);
  layerEffects = new Map();
  render();
});
regenerate.addEventListener("contextmenu", previousGeneration);

function reorderCurrentGeneration() {
  if (!currentGeneration || currentGeneration.layerCount < 2) return;
  clearTimeout(debounce);
  // Work from the visible generation, including when another render is pending.
  const { order: visibleOrder, layerCount } = currentGeneration;
  const selected = visibleOrder.slice(0, layerCount);
  const rearranged = shuffled(selected);
  if (rearranged.every((filename, index) => filename === selected[index])) {
    [rearranged[0], rearranged[1]] = [rearranged[1], rearranged[0]];
  }
  order = [...rearranged, ...visibleOrder.slice(layerCount)];
  layerEffects = new Map(currentGeneration.effects);
  slider.value = layerCount;
  count.value = slider.value;
  return render();
}
reorder.addEventListener("click", reorderCurrentGeneration);
reorder.addEventListener("contextmenu", previousGeneration);

function shuffleCurrentEffects() {
  if (!currentGeneration) return;
  clearTimeout(debounce);
  order = [...currentGeneration.order];
  layerEffects = new Map();
  slider.value = currentGeneration.layerCount;
  count.value = slider.value;
  return render();
}
shuffleEffects.addEventListener("click", shuffleCurrentEffects);
shuffleEffects.addEventListener("contextmenu", previousGeneration);

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Leave time for the browser to consume the download before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

download.addEventListener("click", async () => {
  if (!hasRendered || !currentGeneration || exporting) return;
  exporting = true;
  download.disabled = true;
  try {
    const exportedAt = new Date().toISOString();
    const filename = `dratinis-${exportedAt.replace(/[:.]/g, "-")}`;
    // Capture the committed generation before encoding, so both files describe
    // the same visible artwork even if a new render finishes while we await it.
    const metadata = createGenerationMetadata(currentGeneration, {
      width: canvas.width,
      height: canvas.height,
      background: background.value,
      exportedAt,
    });
    const json = new Blob([JSON.stringify(metadata, null, 2) + "\n"], { type: "application/json" });
    // The canvas backing store is always full resolution; zoom and pan are CSS only.
    // toBlob snapshots the displayed composition at the moment of the click.
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Unable to encode the canvas as PNG");
    downloadFile(blob, `${filename}.png`);
    // Give the browser time to start the first transfer before starting another.
    await new Promise(resolve => setTimeout(resolve, 1000));
    downloadFile(json, `${filename}.json`);
  } catch (error) {
    status.className = "error";
    status.textContent = "The PNG and JSON couldn’t both be saved. Press Download to try again.";
    console.error(error);
  } finally {
    exporting = false;
    download.disabled = !hasRendered;
  }
});

document.querySelector("form").addEventListener("submit", event => event.preventDefault());
favorites = createFavorites({
  canvas,
  foreground,
  getMetadata: () => currentGeneration && createGenerationMetadata(currentGeneration, {
    width: canvas.width, height: canvas.height, background: background.value, exportedAt: new Date().toISOString(),
  }),
  recall: recallFavorite,
  downloadFile,
  closeEffects: closeEffectsPanel,
  reportError: text => { status.className = "error"; status.textContent = text; },
});
updateHistoryHint();
updateEffectControls();
fitCanvas();
paint();
initialize();
