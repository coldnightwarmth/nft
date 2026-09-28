import { matchDrifellaFiles } from "./local-drifella.js?v=1";
import { SPRITE_RANGES, spriteOps } from "./sprites.js?v=2";
import { remixRecipe } from "./remix.js?v=1";
import { rankPaintings } from "./rarity.js?v=1";
import {
  BLEND_MODES,
  LAYERS,
  categoryLabel,
  validCustomLayer,
  categoryLayer,
  customLayerFromPath,
  assetsForPack,
  mergedLayer,
  PACKS,
  activeLayers,
  assetTraits,
  DEFAULTS,
  IMAGE_RE,
  clone,
  inferLayer,
  normalizeSettings,
  pickPlan,
  metadata,
  validateCard,
} from "./core.js?v=drifella-19";
import { renderBlob, renderExports, prefetchRecipes, clearImageCache } from "./renderer.js?v=drifella-8";
import * as storage from "./storage.js?v=drifella-4";
import { zip } from "./zip.js?v=drifella-3";

const $ = (id) => document.getElementById(id);
let settings = clone(DEFAULTS),
  presets = {},
  hosted = [],
  drifellaFiles = new Map(),
  local = [],
  useHosted = true,
  slots = [],
  cards = [],
  view = "picker",
  busy = false,
  dbAvailable = true,
  batch = 0,
  history = [],
  studio = null,
  studioURL = null,
  gridURLs = [],
  toastTimer;
const libraryAssets = () =>
  assetsForPack([...hosted.filter(a => settings.builtinSprites || a.pack !== "sprite-library"), ...local], settings.pack);
const catalog = () => {
  const excluded = new Set(settings.disabledAssets);
  return libraryAssets().filter((a) => !excluded.has(a.id));
};
const allAssets = () => [...new Map([...hosted, ...cards.flatMap(c => c.localAssets || []), ...local].map(a => [a.id, a])).values()]; // Disabling hosted generation never breaks existing recipes.
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const option = (value, label) => {
  const o = el("option", "", label);
  o.value = value;
  return o;
};
const button = (label, action, cls = "") => {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", () => run(action));
  return b;
};
function toast(message, error = false) {
  (document.querySelector("dialog[open]") || document.body).append($("toast"));
  clearTimeout(toastTimer);
  $("toast").textContent = message;
  $("toast").classList.toggle("error", error);
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 9000 : 3500,
  );
}
function notice(message) {
  $("notice").textContent = message;
  $("notice").hidden = !message;
}
async function run(fn) {
  if (busy) return;
  busy = true;
  document.body.classList.add("busy");
  document.querySelector("main").setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
  } finally {
    document.querySelector("main").setAttribute("aria-busy", "false");
    busy = false;
    document.body.classList.remove("busy");
    updateCounts();
    await saveSession();
    $("undo-button").disabled = !history.length;
    if (studio)
      $("add-trait").disabled =
        studioMissing() || studio.card.recipe.ops.length >= 128;
  }
}
function on(id, fn) {
  $(id).addEventListener("click", () => run(fn));
}
function workspace() {
  return { settings, presets, useHosted, batch };
}
async function persistState() {
  if (dbAvailable) await storage.putState(workspace());
}
async function persistCard(card) {
  if (dbAvailable) await storage.putCard(card);
}
function checkpoint() {
  history.push({
    slots: slots.map((s) => ({ ...s })),
    cards: [...cards],
    workspace: clone(workspace()),
  });
  if (history.length > 12) history.shift();
  $("undo-button").disabled = false;
}
function snapshotURLs() {
  for (const url of gridURLs) URL.revokeObjectURL(url);
  gridURLs = [];
}
function blobURL(blob) {
  const url = URL.createObjectURL(blob);
  gridURLs.push(url);
  return url;
}
function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function jsonBlob(value) {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
}
const safeName = (id) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
function updateCounts() {
  $("saved-count").textContent = cards.length;
  $("asset-count").textContent = catalog().length;
}
function changeView(next) {
  view = next;
  const picker = next === "picker";
  document.body.classList.toggle("picker-mode", picker);
  $("picker-tab").classList.toggle("active", picker);
  $("collection-tab").classList.toggle("active", !picker);
  $("picker-tab").setAttribute("aria-pressed", picker);
  $("collection-tab").setAttribute("aria-pressed", !picker);
  $("picker-toolbar").hidden = !picker;
  $("collection-toolbar").hidden = picker;
  $("picker-actions").hidden = !picker;
  $("collection-actions").hidden = picker;
  renderGrid();
}
let rarityRanks = null, raritySignature = "";
function refreshRarity(force = false) {
  const signature = JSON.stringify(cards.map(c => [c.id, c.recipe.ops.map(o => [o.layer, o.name])]));
  if (force || signature !== raritySignature) {
    rarityRanks = rankPaintings(cards);
    raritySignature = signature;
  }
}
function filteredCards() {
  const query = $("search").value.toLowerCase();
  const list = cards.filter(
    (c) =>
      `${c.name} ${c.recipe.ops.map((o) => o.name + " " + o.layer).join(" ")}`
        .toLowerCase()
        .includes(query),
  );
  const sort = $("sort").value;
  if (sort === "rarity" || sort === "rarity-last" || rarityRanks) refreshRarity();
  list.sort((a, b) =>
    sort === "rarity-last"
      ? rarityRanks.get(b.id).rank - rarityRanks.get(a.id).rank || a.created.localeCompare(b.created)
      : sort === "rarity"
      ? rarityRanks.get(a.id).rank - rarityRanks.get(b.id).rank || a.created.localeCompare(b.created)
      : sort === "traits-asc"
      ? a.recipe.ops.length - b.recipe.ops.length
      : sort === "oldest"
      ? a.created.localeCompare(b.created)
      : sort === "traits"
          ? b.recipe.ops.length - a.recipe.ops.length
          : sort === "name"
            ? a.name.localeCompare(b.name)
            : b.created.localeCompare(a.created),
  );
  return list;
}
let hoverURL = null, hoverOwner = null, hoverEpoch = 0;
function hideHoverPreview() {
  hoverOwner = null;
  hoverEpoch++;
  $("hover-preview").hidden = true;
  document.body.classList.remove("hover-preview-active");
  if (hoverURL) URL.revokeObjectURL(hoverURL);
  hoverURL = null;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideHoverPreview();
});
window.addEventListener("blur", hideHoverPreview);
document.addEventListener("visibilitychange", hideHoverPreview);
document.addEventListener("scroll", hideHoverPreview, true);
document.addEventListener("pointermove", e => {
  if (hoverOwner && (e.pointerType !== "mouse" || !hoverOwner.contains(document.elementFromPoint(e.clientX, e.clientY)))) hideHoverPreview();
}, true);
document.documentElement.addEventListener("pointerleave", hideHoverPreview);
new MutationObserver(() => {
  if (document.querySelector("dialog[open]")) hideHoverPreview();
}).observe(document.body, {subtree:true, attributes:true, attributeFilter:["open"]});
function renderGrid() {
  hideHoverPreview();
  snapshotURLs();
  $("grid").replaceChildren();
  updateCounts();
  const items = view === "picker" ? slots : filteredCards();
  $("picker-actions").hidden = view !== "picker" || !slots.length;
  document.body.classList.toggle(
    "welcome-mode",
    view === "picker" && !slots.length,
  );
  $("empty").hidden = items.length > 0;
  $("grid").hidden = items.length === 0;
  $("start-options").hidden = view !== "picker";
  $("start-set").value = settings.pack === "custom" ? "" : settings.pack;
  if (settings.pack === "custom" && !local.some((a) => a.pack === "custom"))
    $("custom-folder-name").textContent =
      "Reconnect your custom folder to generate.";
  if (!items.length) {
    $("empty").querySelector("h2").textContent =
      view === "picker"
        ? "Start with a fresh batch."
        : cards.length
          ? "No matching paintings."
          : "Your collection starts here.";
    $("empty").querySelector("p").textContent =
      view === "picker"
        ? "Choose an asset set, then generate your first batch."
        : cards.length
          ? "Try another search."
          : "Save any generation to keep it here. There’s room for more than one favorite.";
    $("empty-generate").textContent =
      view === "picker" ? "Generate batch" : "Back to generator";
  }
  $("collection-total").textContent =
    `${items.length} shown / ${cards.length} saved`;
  items.forEach((card, i) => {
    const saved = cards.some((c) => c.id === card.id);
    const tile = el("article", `tile${saved ? " saved" : ""}`);
    tile.dataset.id = card.id;
    const art = el("div", "tile-art");
    const img = el("img");
    img.src = blobURL(card.thumbnail || card.png);
    img.alt = card.name;
    img.loading = "lazy";
    art.append(img);
    const target = el("button", "preview-target");
    target.type = "button";
    target.setAttribute("aria-label", `Preview ${card.name}`);
    let previewToken = 0;
    const showPreview = async (event) => {
      if (!event.isTrusted || event.pointerType !== "mouse" || (!event.movementX && !event.movementY) || busy || document.querySelector("dialog[open]")) return;
      if (!target.contains(document.elementFromPoint(event.clientX, event.clientY))) return;
      if (hoverOwner === target) return;
      hideHoverPreview();
      hoverOwner = target;
      const epoch = hoverEpoch;
      const token = ++previewToken;
      $("hover-preview-image").src = img.src;
      $("hover-preview").hidden = false;
      document.body.classList.add("hover-preview-active");
      try {
        const blob =
          card.png ||
          (await renderBlob(card.recipe, allAssets(), {
            width: Math.min(1200, card.recipe.width),
          }));
        if (token !== previewToken || epoch !== hoverEpoch || hoverOwner !== target || !target.isConnected || !target.matches(":hover") || $("hover-preview").hidden || document.querySelector("dialog[open]")) return;
        if (hoverURL) URL.revokeObjectURL(hoverURL);
        hoverURL = URL.createObjectURL(blob);
        $("hover-preview-image").src = hoverURL;
      } catch {
        /* Keep the available preview if local sources are disconnected. */
      }
    };
    const closePreview = () => {
      previewToken++;
      hideHoverPreview();
    };
    target.addEventListener("pointermove", showPreview);
    target.addEventListener("pointerleave", closePreview);
    target.addEventListener("pointercancel", closePreview);
    target.addEventListener("blur", closePreview);
    target.addEventListener("click", () => {
      if (busy) return;
      closePreview();
      run(() => openCard(card));
    });
    art.append(target);
    tile.append(art);
    if (view !== "picker") {
      const title = el("div", "tile-heading");
      title.append(
        el("span", "tile-number", String(i + 1).padStart(2, "0")),
        el("span", "tile-name", card.name),
        el("span", "grow"),
        el("span", "tile-count", `${card.recipe.ops.length} layers`),
      );
      if (rarityRanks?.has(card.id)) {
        const rank = rarityRanks.get(card.id).rank;
        const percentile = rank / cards.length;
        const tier = percentile <= 0.01 ? "top-one" : percentile <= 0.1 ? "top-ten" : percentile <= 0.5 ? "top-half" : "";
        const badge = el("span", `painting-rank ${tier}`, `#${rank}`);
        badge.setAttribute("aria-label", `Rarity rank ${rank} of ${cards.length}`);
        title.append(badge);
      }
      tile.append(title);
    }
    const actions = el("div", "tile-actions");
    if (view === "picker") {
      const save = button(
        saved ? "✓ Saved" : "＋ Save",
        () => (saved ? deleteCard(card, true) : saveCard(card)),
        saved ? "" : "primary",
      );
      save.setAttribute("aria-pressed", String(saved));
      actions.append(
        button("Edit", () => openCard(card), "edit-painting"),
        save,
        button("Remix", () => remixBatch(card)),
      );
    } else {
      const remove = button("", () => deleteCard(card), "remove-painting");
      const removeIcon = el("span", "remove-icon", "×");
      removeIcon.setAttribute("aria-hidden", "true");
      remove.append(removeIcon);
      remove.setAttribute("aria-label", `Remove ${card.name}`);
      actions.append(
        el("span", "grow"),
        button("Edit", () => openCard(card), "edit-painting"),
        button("↓ PNG", async () => { const full = await materialize(card); download(full.png, `${safeName(card.id)}.png`); }),
        remove,
      );
    }
    tile.append(actions);
    $("grid").append(tile);
  });
  fitGrid();
}

// Choose the arrangement that gives portrait artwork the most space in the viewport.
function fitGrid() {
  if (view !== "picker" || !slots.length) return;
  const grid = $("grid"),
    gap = 8;
  const { width, height } = grid.getBoundingClientRect();
  let best = { score: -1, columns: 1, rows: slots.length };
  const ratio = slots[0].recipe.width / slots[0].recipe.height;
  for (let columns = 1; columns <= Math.min(slots.length, 6); columns++) {
    const rows = Math.ceil(slots.length / columns);
    const cellWidth = (width - gap * (columns - 1)) / columns;
    const cellHeight = (height - gap * (rows - 1)) / rows;
    const score = Math.min(
      cellWidth - 14,
      Math.max(0, cellHeight - 44) * ratio,
    );
    if (score > best.score) best = { score, columns, rows };
  }
  grid.style.setProperty("--columns", best.columns);
  grid.style.setProperty("--rows", best.rows);
}
new ResizeObserver(fitGrid).observe($("grid"));

async function generate() {
  hideHoverPreview();
  $("generation-loading").hidden = false;
  try { await generateBatch(); }
  finally { $("generation-loading").hidden = true; }
}
async function remixBatch(source) {
  hideHoverPreview();
  $("generation-loading").hidden = false;
  try {
    const excluded = new Set(settings.disabledAssets);
    const assets = assetsForPack(allAssets(), source.recipe.pack || settings.pack)
      .filter(a => !excluded.has(a.id) && settings.enabled[a.layer] !== false);
    const next = [];
    for (let i=0; i<slots.length; i++) {
      if (slots[i].id === source.id) { next.push(slots[i]); continue; }
      $("generation-progress").textContent = `Remixing ${i+1} of ${slots.length}…`;
      const id = crypto.randomUUID();
      const recipe = remixRecipe(source.recipe, assets, id);
      const thumbnail = await renderBlob(recipe, allAssets(), {width:480});
      next.push({id, name:`Painting ${String(batch+1).padStart(3,"0")}.${String(i+1).padStart(2,"0")}`, created:new Date().toISOString(),recipe,thumbnail});
    }
    if (dbAvailable) await storage.putState({...workspace(),batch:batch+1});
    checkpoint();
    slots = next;
    batch++;
    renderGrid();
  } finally { $("generation-loading").hidden = true; }
}
async function generateBatch() {
  if (!catalog().length)
    throw Error("Load an asset folder or enable the hosted library first.");
  const pool = catalog(), assets = allAssets();
  const nextBatch = batch + 1;
  const next = Array.from({length:settings.count}, (_,i) => {
    const id = crypto.randomUUID();
    return {id, name:`Painting ${String(nextBatch).padStart(3,"0")}.${String(i+1).padStart(2,"0")}`,
      created:new Date().toISOString(),
      recipe:pickPlan(pool, {...settings,jitter:false,enabled:{...settings.enabled,sprite:false}},id), locked:false};
  });
  // Begin the whole batch's network work before rendering; consume all rejections.
  const downloads = prefetchRecipes(next.map(c => c.recipe), assets).catch(() => {});
  for (let i=0;i<next.length;i++) {
    $("batch-status").textContent = `Rendering ${i+1} of ${next.length}…`;
    $("generation-progress").textContent = `Generating ${i+1} of ${next.length}…`;
    next[i].thumbnail = await renderBlob(next[i].recipe, assets, {width:480});
  }
  await downloads;
  if (dbAvailable) await storage.putState({ ...workspace(), batch: nextBatch });
  checkpoint();
  slots = next;
  batch = nextBatch;
  renderGrid();
}
async function materialize(card, dirty = false) {
  const clean = { ...card };
  delete clean.locked;
  if (!clean.png || dirty) {
    Object.assign(clean, await renderExports(clean.recipe, allAssets()));
    if (!clean.thumbnail || dirty) clean.thumbnail = await renderBlob(clean.recipe, allAssets(), {width:480});
  }
  return clean;
}
async function saveCard(card, dirty = false) {
  $("toast").hidden = true;
  const saved = { ...card };
  delete saved.locked;
  if (dirty) {
    delete saved.png;
    delete saved.overlay;
    saved.thumbnail = await renderBlob(saved.recipe, allAssets(), {width:480});
  }
  const used = new Set(saved.recipe.ops.map(op => op.assetId));
  saved.localAssets = allAssets().filter(a => a.file && used.has(a.id));
  await persistCard(saved);
  checkpoint();
  const i = cards.findIndex((c) => c.id === saved.id);
  if (i < 0) cards.push(saved);
  else cards[i] = saved;
  slots = slots.map((s) =>
    s.id === saved.id ? { ...saved, locked: s.locked } : s,
  );
  renderGrid();
  return saved;
}
async function deleteCard(card, quiet = false) {
  if (dbAvailable) await storage.removeCard(card.id);
  checkpoint();
  cards = cards.filter((c) => c.id !== card.id);
  renderGrid();
  if (!quiet) toast("Removed from collection. Undo brings it back.");
}
async function undo() {
  const state = history.at(-1);
  if (!state) return;
  if (dbAvailable) await storage.replaceWorkspace(state.cards, state.workspace);
  history.pop();
  cards = state.cards;
  slots = state.slots;
  ({ settings, presets, useHosted, batch } = clone(state.workspace));
  settingsUI();
  assetSummary();
  renderGrid();
}
const openAssetFolders = new Set(),
  folderPages = new Map();
let assetGalleryURLs = [],
  assetSearchTimer;
function releaseAssetURLs() {
  for (const url of assetGalleryURLs) URL.revokeObjectURL(url);
  assetGalleryURLs = [];
}
function assetURL(asset) {
  if (!asset.file) return asset.url;
  const url = URL.createObjectURL(asset.file);
  assetGalleryURLs.push(url);
  return url;
}
async function setAssetsEnabled(assets, enabled) {
  const excluded = new Set(settings.disabledAssets);
  for (const a of assets) enabled ? excluded.delete(a.id) : excluded.add(a.id);
  const next = { ...settings, disabledAssets: [...excluded] };
  if (dbAvailable) await storage.putState({ ...workspace(), settings: next });
  settings = next;
  renderAssetFolders();
  updateCounts();
}
async function unloadAssets(assets) {
  const ids = new Set(assets.filter(a => a.source === "local").map(a => a.id));
  if (!ids.size) return;
  const next = { ...settings, disabledAssets: settings.disabledAssets.filter(id => !ids.has(id)) };
  if (dbAvailable) await storage.putState({ ...workspace(), settings: next });
  settings = next;
  local = local.filter(a => !ids.has(a.id));
  clearImageCache();
  assetSummary();
}
let draggedLayer = null;
function renderAssetFolders() {
  releaseAssetURLs();
  const container = $("asset-summary"),
    scrollTop = $("assets-dialog").scrollTop;
  container.replaceChildren();
  const query = $("asset-search").value.trim().toLowerCase(),
    excluded = new Set(settings.disabledAssets);
  const available = libraryAssets();
  let matches = 0;
  for (const layer of [...activeLayers(settings)].reverse().filter(l => l !== "sprite")) {
    const assets = available.filter((a) => a.layer === layer);
    const filtered = assets.filter((a) =>
      `${a.name} ${a.sourceLayer || a.layer} ${PACKS.find((p) => p.id === a.pack)?.name || "Local"} ${a.source}`
        .toLowerCase()
        .includes(query),
    );
    if (query && !filtered.length) continue;
    matches += filtered.length;
    const folder = el("details", "asset-folder");
    folder.dataset.layer = layer;
    folder.open = openAssetFolders.has(layer) || !!query;
    const summary = el("summary", "asset-folder-summary");
    const count = assets.filter((a) => !excluded.has(a.id)).length;
    summary.append(
      el("strong", "", categoryLabel(layer)),
      el("span", "quiet", `${count} / ${assets.length} enabled`),
    );
    const categoryToggle = el("input");
    categoryToggle.type = "checkbox";
    categoryToggle.checked = settings.enabled[layer] !== false;
    categoryToggle.setAttribute("aria-label", `Enable category ${categoryLabel(layer)}`);
    categoryToggle.addEventListener("click", e => e.stopPropagation());
    categoryToggle.addEventListener("change", () => run(async () => {
      settings.enabled[layer] = categoryToggle.checked;
      await persistState();
      settingsUI();
    }));
    if (layer === "custom:sprites" || settings.spriteCategories.includes(layer))
      summary.querySelector("strong").append(el("small", "sprite-category-tag", "SPRITE"));
    summary.prepend(categoryToggle);
    const disclosure = el("span", "category-disclosure", "▸");
    disclosure.setAttribute("aria-hidden", "true");
    summary.querySelector("strong").before(disclosure);
    const handle = el("span", "layer-drag-handle", "☰");
    handle.draggable = true;
    handle.tabIndex = 0;
    handle.setAttribute("role", "button");
    handle.setAttribute("aria-label", `Reorder ${categoryLabel(layer)}; use arrow keys to move`);
    handle.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); });
    const reorder = async (target, after) => {
      const order = [...activeLayers(settings)].reverse().filter(l => l !== layer);
      order.splice(order.indexOf(target) + (after ? 1 : 0), 0, layer);
      settings.layerOrders[settings.pack] = order.reverse();
      settings.randomOrder = false;
      await persistState();
      settingsUI();
      renderAssetFolders();
    };
    handle.addEventListener("keydown", e => {
      if (!["ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const order = [...activeLayers(settings)].reverse(), i = order.indexOf(layer);
      const target = order[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (target) run(() => reorder(target, e.key === "ArrowDown"));
    });
    handle.addEventListener("dragstart", e => {
      draggedLayer = layer;
      e.dataTransfer.setData("text/plain", layer);
      e.dataTransfer.effectAllowed = "move";
    });
    handle.addEventListener("dragend", () => {
      if (draggedLayer) { draggedLayer = null; renderAssetFolders(); }
    });
    folder.addEventListener("dragover", e => {
      if (!draggedLayer) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (draggedLayer === layer) return;
      const source = [...container.children].find(node => node.dataset.layer === draggedLayer);
      if (!source) return;
      const after = e.clientY > summary.getBoundingClientRect().top + summary.offsetHeight / 2;
      const before = new Map([...container.children].map(node => [node, node.getBoundingClientRect().top]));
      container.insertBefore(source, after ? folder.nextSibling : folder);
      for (const [node, top] of before) {
        const delta = top - node.getBoundingClientRect().top;
        if (delta && node !== source) node.animate([{transform: `translateY(${delta}px)`}, {transform: "translateY(0)"}], {duration: 120, easing: "ease-out"});
      }
    });
    folder.addEventListener("drop", e => {
      if (!draggedLayer) return;
      e.preventDefault();
      draggedLayer = null;
      const visible = [...container.children].map(node => node.dataset.layer).filter(Boolean);
      const visibleSet = new Set(visible);
      let i = 0;
      const order = [...activeLayers(settings)].reverse().map(l => visibleSet.has(l) ? visible[i++] : l);
      run(async () => {
        settings.layerOrders[settings.pack] = order.reverse();
        settings.randomOrder = false;
        await persistState();
        settingsUI();
        renderAssetFolders();
      });
    });
    summary.append(handle);
    folder.append(summary);
    folder.addEventListener("toggle", () => {
      if (folder.open) openAssetFolders.add(layer);
      else openAssetFolders.delete(layer);
      if (folder.open && !folder.querySelector(".asset-folder-body"))
        fillFolder();
    });
    const fillFolder = () => {
      const body = el("div", "asset-folder-body"),
        tools = el("div", "asset-folder-tools");
      tools.append(
        button("Enable all", () => setAssetsEnabled(assets, true)),
        button("Disable all", () => setAssetsEnabled(assets, false)),
      );
      const localMatches = assets.filter(a => a.source === "local");
      if (localMatches.length)
        tools.append(button("Unload all local assets", () => unloadAssets(localMatches)));
      if (!filtered.length) {
        body.append(el("p", "muted", "No assets loaded in this folder."));
        folder.append(body);
        return;
      }
      const pageSize = 48,
        lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1),
        page = Math.min(folderPages.get(layer) || 0, lastPage);
      const prev = button("←", () => {
        folderPages.set(layer, page - 1);
        renderAssetFolders();
      });
      prev.setAttribute("aria-label", "Previous page");
      prev.disabled = page === 0;
      const next = button("→", () => {
        folderPages.set(layer, page + 1);
        renderAssetFolders();
      });
      next.setAttribute("aria-label", "Next page");
      next.disabled = page === lastPage;
      tools.append(
        el("span", "grow"),
        prev,
        el("span", "quiet", `${page + 1} / ${lastPage + 1}`),
        next,
      );
      body.append(tools);
      const gallery = el("div", "asset-gallery");
      for (const a of filtered.slice(page * pageSize, (page + 1) * pageSize)) {
        const enabled = !excluded.has(a.id),
          tile = el("article", `asset-item${enabled ? "" : " excluded"}`);
        tile.dataset.assetId = a.id;
        const preview = button(
          "",
          () => {
            $("asset-preview-dialog").dataset.assetId = a.id;
            $("asset-preview-title").textContent = a.name;
            $("asset-preview-image").src = assetURL(a);
            $("asset-preview-image").alt = a.name;
            $("asset-preview-caption").textContent =
              `${PACKS.find((p) => p.id === a.pack)?.name || "Local"} / ${a.sourceLayer || a.layer} · Weight ${a.weight ?? 1}${a.empty ? " · Empty choice" : ""}`;
            $("asset-preview-actions").replaceChildren();
            if (a.source === "local")
              $("asset-preview-actions").append(button("Unload asset", async () => {
                await unloadAssets([a]);
                $("asset-preview-dialog").close();
              }));
            $("asset-preview-dialog").showModal();
          },
          "asset-image",
        );
        preview.setAttribute("aria-label", `Preview ${a.name}`);
        const img = el("img");
        img.src = a.thumbnailUrl || assetURL(a);
        img.alt = a.name;
        img.loading = "lazy";
        img.decoding = "async";
        img.onerror = () => {
          if (a.thumbnailUrl && img.src === a.thumbnailUrl) { img.src = assetURL(a); return; }
          img.hidden = true;
          preview.append(el("span", "muted", "Preview unavailable"));
        };
        preview.append(img);
        if (a.empty) preview.append(el("span", "empty-asset", "Empty choice"));
        const label = el("label", "asset-toggle"),
          check = el("input");
        check.type = "checkbox";
        check.checked = enabled;
        check.setAttribute("aria-label", `Include ${a.name} in generation`);
        check.addEventListener("change", () => {
          const desired = check.checked;
          if (busy) {
            check.checked = enabled;
            return;
          }
          run(async () => {
            try {
              await setAssetsEnabled([a], desired);
            } catch (error) {
              renderAssetFolders();
              throw error;
            }
          });
        });
        label.append(check, el("span", "asset-name", a.name));
        const origin = el(
          "div",
          "asset-origin",
          `${PACKS.find((p) => p.id === a.pack)?.name || "Local"} · ${a.sourceLayer || a.layer}`,
        );
        tile.append(preview, label, origin);
        if (a.source === "local") {
          const unload = button("Unload", () => unloadAssets([a]));
          unload.setAttribute("aria-label", `Unload ${a.name}`);
          tile.append(unload);
        }
        gallery.append(tile);
      }
      body.append(gallery);
      folder.append(body);
    };
    if (folder.open) fillFolder();
    container.append(folder);
  }
  if (query && !matches)
    container.append(el("p", "muted", "No matching assets."));
  $("assets-dialog").scrollTop = scrollTop;
}
$("asset-search").addEventListener("input", () => {
  clearTimeout(assetSearchTimer);
  assetSearchTimer = setTimeout(() => {
    folderPages.clear();
    renderAssetFolders();
  }, 180);
});
$("assets-dialog").addEventListener("close", () => {
  releaseAssetURLs();
  $("asset-summary").replaceChildren();
});

function assetSummary() {
  $("builtin-sprites-toggle").textContent = settings.builtinSprites ? "− Remove sprites" : "＋ Add sprites";
  $("builtin-sprites-toggle").setAttribute("aria-pressed", settings.builtinSprites);
  $("library-select").value = settings.pack;
  $("start-set").value = settings.pack === "custom" ? "" : settings.pack;
  if (settings.pack === "custom" && !local.some((a) => a.pack === "custom"))
    $("custom-folder-name").textContent =
      "Reconnect your custom folder to generate.";
  renderAssetFolders();
  $("local-sources").replaceChildren();
  const sources = [...new Set(local.map((a) => a.group))];
  for (const source of sources) {
    const row = el("div", "preset-row");
    row.append(
      el(
        "span",
        "grow",
        `${source} · ${local.filter((a) => a.group === source).length} images`,
      ),
      button("Disconnect", () => {
        local = local.filter((a) => a.group !== source);
        clearImageCache();
        assetSummary();
        updateCounts();
        toast("Folder disconnected. Saved images are still available.");
      }),
    );
    $("local-sources").append(row);
  }
  updateCounts();
}
async function loadCustomFolder(files) {
  const assets = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (
      !IMAGE_RE.test(file.name) ||
      path.split("/").some((p) => p.startsWith("."))
    )
      continue;
    const layer = customLayerFromPath(path);
    assets.push({
      id: `local:${layer}:${path}:${file.size}:${file.lastModified}`,
      layer,
      pack: "custom",
      ...assetTraits(file.name),
      path,
      source: "local",
      file,
      group: path.split("/")[0],
    });
  }
  if (!assets.length)
    throw Error(
      "No supported images found in this folder. Choose a folder containing image files in trait subfolders.",
    );
  const layers = [...new Set(assets.map((a) => a.layer))].sort((a, b) =>
    a === "background"
      ? -1
      : b === "background"
        ? 1
        : a.localeCompare(b, undefined, { numeric: true }),
  );
  const next = normalizeSettings({
    ...settings,
    pack: "custom",
    customLayers: layers,
  });
  if (dbAvailable) await storage.putState({ ...workspace(), settings: next });
  local = [...local.filter((a) => a.pack !== "custom"), ...assets];
  settings = next;
  clearImageCache();
  assetSummary();
  settingsUI();
  $("custom-folder-name").textContent =
    `${assets[0].group} · ${assets.length} images · ${layers.length} categories`;
  renderGrid();
}
$("custom-folder-button").onclick = () => {
  if (!busy) $("custom-folder-input").click();
};
$("custom-folder-input").onchange = (e) =>
  run(async () => {
    if (e.target.files.length) await loadCustomFolder([...e.target.files]);
    e.target.value = "";
  });

let pendingImages = [];
function supportedFiles(files) {
  return files.filter(file => IMAGE_RE.test(file.name) && !(file.webkitRelativePath || file.name).split("/").some(p => p.startsWith(".")));
}
async function loadFiles(files, layer, spriteCategory = false) {
  files = supportedFiles(files);
  if (!files.length) throw Error("No supported images found.");
  const nextSettings = clone(settings);
  if (spriteCategory) {
    nextSettings.spriteCategories = [...new Set([...nextSettings.spriteCategories, layer])];
    nextSettings.spriteCategoriesEnabled = true;
  }
  if (!activeLayers(settings).includes(layer)) {
    if (settings.pack === "custom") nextSettings.customLayers.push(layer);
    else (nextSettings.additionalLayers[settings.pack] ||= []).push(layer);
  }
  settings = normalizeSettings(nextSettings);
  await persistState();
  const next = new Map(local.map(a => [a.id, a]));
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const id = `local:${settings.pack}:${layer}:${path}:${file.size}:${file.lastModified}`;
    next.set(id, {id, layer, pack: settings.pack, ...assetTraits(file.name), path,
      source: "local", file, group: file.webkitRelativePath?.split("/")[0] || `Files · ${categoryLabel(layer)}`});
  }
  local = [...next.values()];
  clearImageCache();
  assetSummary();
  settingsUI();
  $("new-layers-dialog").close();
}
function newCategory(name) {
  name = name.trim();
  if (!name) throw Error("Enter a category name.");
  let layer = `custom:${name}`, suffix = 2;
  while (activeLayers(settings).includes(layer)) layer = `custom:${name} (${suffix++})`;
  return layer;
}
function applyDrifellaFiles() {
  for (const asset of hosted) {
    if (!drifellaFiles.has(asset.path)) continue;
    asset.file = drifellaFiles.get(asset.path);
    asset.thumbnailUrl = null;
  }
  $("local-drifella-status").textContent = drifellaFiles.size
    ? `${drifellaFiles.size} local files connected. Other traits use hosted files.` : "";
  clearImageCache();
}
$("local-drifella-button").onclick = () => {
  if (!busy) $("local-drifella-input").click();
};
$("local-drifella-input").onchange = event => run(async () => {
  const files = [...event.target.files];
  event.target.value = "";
  if (!files.length) return;
  $("local-drifella-status").textContent = "Matching local files…";
  const {matches, matchedFiles} = await matchDrifellaFiles(files, hosted);
  for (const [path, file] of matches) drifellaFiles.set(path, file);
  applyDrifellaFiles();
  assetSummary();
  if (!matchedFiles) throw Error("No matching Drifella layers found. Choose an extracted Drifella collection or trait folder with its original filenames.");
  toast(`Connected ${matchedFiles} local files. Unmatched files were skipped.`);
});
async function loadHosted() {
  const manifestURL = new URL("./assets/manifest.json", document.baseURI),
    response = await fetch(manifestURL, { cache: "no-store" });
  if (!response.ok)
    throw Error(
      `Hosted manifest unavailable (${response.status}). Load a local folder to start.`,
    );
  const manifest = await response.json();
  const spriteResponse = await fetch(new URL("./assets/sprites.json", document.baseURI), {cache:"no-store"});
  if (!spriteResponse.ok) throw Error("Could not load the sprite library.");
  const spriteManifest = await spriteResponse.json();
  manifest.assets.push(...spriteManifest.assets.map(a => ({...a, losslessHosted:true})));
  if (manifest.version !== 1 || !Array.isArray(manifest.assets))
    throw Error("Hosted manifest must have version 1 and an assets array.");
  const seen = new Set();
  hosted = manifest.assets.map((a, i) => {
    if ((!LAYERS.includes(a.layer) && !validCustomLayer(a.layer)) || typeof a.path !== "string")
      throw Error(
        `Hosted asset ${i} has an unsupported layer “${a.layer}” or a missing path. Refresh to load the latest library.`,
      );
    const url = new URL(a.path, manifestURL);
    if (!["http:", "https:"].includes(url.protocol))
      throw Error("Hosted asset URLs must use HTTP or HTTPS.");
    const id = a.id || `hosted:${a.layer}:${a.path}`;
    if (seen.has(id)) throw Error(`Duplicate asset id: ${id}`);
    seen.add(id);
    return {
      id,
      layer: a.layer,
      pack: a.pack,
      weight: a.weight ?? 1,
      empty: !!a.empty,
      name:
        a.name ||
        decodeURIComponent(url.pathname.split("/").pop()).replace(IMAGE_RE, ""),
      originalPath: a.originalPath,
      path: a.path,
      url: url.href,
      thumbnailUrl: new URL(`thumbs/${a.path}`, manifestURL).href,
      originalUrl: !a.losslessHosted && manifest.originalsBaseURL ? new URL(a.path, manifest.originalsBaseURL).href : url.href,
      source: "hosted",
    };
  });
}
function settingsUI() {
  $("sprite-categories-enabled").checked = settings.spriteCategoriesEnabled;
  $("sprite-placement-controls").hidden = !settings.spriteCategoriesEnabled;
  $("sprite-range-controls").replaceChildren();
  for (const [key,spec] of Object.entries(SPRITE_RANGES)) {
    const row = el("div", "sprite-range-row compact-sprite-range");
    row.append(el("strong", "", spec.label));
    const track = el("div", "sprite-dual-range");
    const output = el("output");
    const modeLabel = el("label", "sprite-range-mode");
    const mode = el("input"); mode.type="checkbox";
    mode.checked = settings.spriteRangeModes?.[key] !== false;
    mode.setAttribute("aria-label", `${spec.label} range`);
    modeLabel.append(mode, el("span", "", "Range"));
    const sliders = [0,1].map(index => {
      const input = el("input"); input.type="range"; input.min=spec.min; input.max=spec.max; input.step=1;
      input.setAttribute("aria-label", `${spec.label} ${index ? "maximum" : "minimum"}`);
      input.oninput = () => {
        const value=Number(input.value);
        settings.spritePlacement[key][index]=value;
        if (mode.checked) {
          if(index===0 && value>settings.spritePlacement[key][1]) settings.spritePlacement[key][1]=value;
          if(index===1 && value<settings.spritePlacement[key][0]) settings.spritePlacement[key][0]=value;
        }
        update();
      };
      input.onchange=()=>run(persistState);
      track.append(input);
      return input;
    });
    function update() {
      const pair=settings.spritePlacement[key];
      sliders.forEach((slider,i)=>slider.value=pair[i]);
      sliders[1].hidden=!mode.checked;
      output.textContent=(mode.checked ? pair.join(" – ") : pair[0])+spec.unit;
      track.style.setProperty("--range-start", `${100*(pair[0]-spec.min)/(spec.max-spec.min)}%`);
      track.style.setProperty("--range-end", `${100*((mode.checked?pair[1]:pair[0])-spec.min)/(spec.max-spec.min)}%`);
    }
    mode.onchange=()=>run(async()=>{
      (settings.spriteRangeModes ||= {})[key]=mode.checked;
      if(mode.checked) settings.spritePlacement[key].sort((a,b)=>a-b);
      update(); await persistState();
    });
    let rangeDrag = null;
    track.addEventListener("pointerdown", event => {
      if(event.target !== track || event.button !== 0 || busy) return;
      const rect=track.getBoundingClientRect();
      const value=spec.min+Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width))*(spec.max-spec.min);
      const pair=settings.spritePlacement[key];
      if (mode.checked && value > pair[0] && value < pair[1]) {
        event.preventDefault();
        rangeDrag = {pointerId:event.pointerId, x:event.clientX, width:rect.width, pair:[...pair]};
        track.setPointerCapture(event.pointerId);
        track.classList.add("dragging-range");
        return;
      }
      const index=mode.checked && Math.abs(value-pair[1])<Math.abs(value-pair[0]) ? 1 : 0;
      sliders[index].value=Math.round(value); sliders[index].dispatchEvent(new Event("input")); sliders[index].focus();
      run(persistState);
    });
    track.addEventListener("pointermove", event => {
      if (!rangeDrag || event.pointerId !== rangeDrag.pointerId) return;
      const {pair, x, width} = rangeDrag;
      const delta = Math.max(spec.min-pair[0], Math.min(spec.max-pair[1],
        Math.round((event.clientX-x)/width*(spec.max-spec.min))));
      settings.spritePlacement[key] = pair.map(value => value+delta);
      update();
    });
    const finishRangeDrag = event => {
      if (!rangeDrag || event.pointerId !== rangeDrag.pointerId) return;
      rangeDrag = null;
      track.classList.remove("dragging-range");
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      run(persistState);
    };
    track.addEventListener("pointerup", finishRangeDrag);
    track.addEventListener("pointercancel", finishRangeDrag);
    track.addEventListener("lostpointercapture", finishRangeDrag);
    update();
    row.append(track, output, modeLabel);
    $("sprite-range-controls").append(row);
  }
  $("canvas-width").value = settings.width;
  $("canvas-height").value = settings.height;
  $("canvas-color").value = settings.color;
  $("random-blend").checked = settings.randomBlend;
  $("random-opacity").checked = settings.randomOpacity;
  $("random-order").checked = settings.randomOrder;
  $("batch-count").value = settings.count;
  $("layer-settings").replaceChildren();
  for (const layer of [...activeLayers(settings)].reverse().filter((l) => l !== "sprite")) {
    const row = el("div", "weight-row"),
      check = el("input"),
      label = el("label", "", categoryLabel(layer)),
      range = el("input"),
      output = el("output");
    check.type = "checkbox";
    check.checked = settings.enabled[layer];
    check.setAttribute("aria-label", `Enable ${layer}`);
    range.type = "range";
    range.min = 0;
    range.max = 100;
    range.value = Math.round((1 - settings.empty[layer]) * 100);
    range.setAttribute("aria-label", `${layer} probability`);
    output.textContent = `${range.value}%`;
    check.onchange = () =>
      run(async () => {
        settings.enabled[layer] = check.checked;
        await persistState();
      });
    range.oninput = () => {
      output.textContent = `${range.value}%`;
    };
    range.onchange = () =>
      run(async () => {
        settings.empty[layer] = 1 - Number(range.value) / 100;
        await persistState();
      });
    const repeat = el("select");
    for (let count = 1; count <= 9; count++) repeat.append(option(count, String(count)));
    repeat.value = Math.min(9, settings.repeats[layer] || 1);
    repeat.setAttribute("aria-label", `${categoryLabel(layer)} repeat count`);
    repeat.onchange = () => run(async () => {
      settings.repeats[layer] = Math.max(1, Math.min(9, Math.round(Number(repeat.value) || 1)));
      repeat.value = settings.repeats[layer];
      await persistState();
    });
    const repeatLabel = el("label", "repeat-control", "Repeat");
    repeatLabel.append(repeat);
    row.append(check, label, range, output, repeatLabel);
    $("layer-settings").append(row);
  }
  $("preset-list").replaceChildren();
  for (const [name, preset] of Object.entries(presets)) {
    const row = el("div", "preset-row");
    row.append(
      button(name, async () => {
        settings = normalizeSettings(preset);
        await persistState();
        settingsUI();
        toast(`Loaded “${name}”.`);
      }),
      button("×", async () => {
        delete presets[name];
        await persistState();
        settingsUI();
      }),
    );
    $("preset-list").append(row);
  }
}
function setStudioImage(blob) {
  if (studioURL) URL.revokeObjectURL(studioURL);
  studioURL = URL.createObjectURL(blob);
  $("studio-image").src = studioURL;
}
function studioMissing() {
  return studio.card.recipe.ops.some(
    (o) => !allAssets().some((a) => a.id === o.assetId),
  );
}
function openCard(card) {
  hideHoverPreview();
  $("add-layer").replaceChildren(
    ...activeLayers({
      pack: card.recipe.pack || settings.pack,
      additionalLayers: card.recipe.additionalLayers || settings.additionalLayers,
      customLayers: card.recipe.customLayers || settings.customLayers,
      builtinSprites: card.recipe.builtinSprites || settings.builtinSprites,
    }).filter(l => l !== "sprite").map((l) => option(l, categoryLabel(l))),
  );
  const overlayOption = [...$("add-layer").options].find(o => categoryLabel(o.value).toLowerCase() === "overlay");
  if (overlayOption) $("add-layer").value = overlayOption.value;
  studio = { card: clone(card), original: clone(card), dirty: false };
  $("card-title").textContent = card.name;
  $("card-name").value = card.name;
  $("card-eyebrow").textContent = cards.some((c) => c.id === card.id)
    ? "SAVED PAINTING"
    : "PAINTING STUDIO";
  setStudioImage(card.thumbnail || card.png);
  studioLayers();
  $("card-dialog").showModal();
}
async function refreshStudio() {
  const blob = await renderBlob(studio.card.recipe, allAssets(), {
    width: 800,
  });
  setStudioImage(blob);
  studio.dirty = true;
  studioLayers();
}
async function editRecipe(fn) {
  const prev = clone(studio.card.recipe);
  try {
    fn();
    await refreshStudio();
  } catch (e) {
    studio.card.recipe = prev;
    studioLayers();
    throw e;
  }
}
function updateStudioActions() {
  if (!studio) return;
  const changed = JSON.stringify(studio.card.recipe) !== JSON.stringify(studio.original.recipe) ||
    ($("card-name").value.trim() || studio.original.name) !== studio.original.name;
  $("studio-save-actions").hidden = !changed;
}
$("card-name").addEventListener("input", updateStudioActions);
let studioTraitURLs = [];
function releaseStudioTraits() {
  studioTraitURLs.forEach(url => URL.revokeObjectURL(url));
  studioTraitURLs = [];
}
function studioLayers() {
  const scrollTop = $("studio-layers").scrollTop;
  releaseStudioTraits();
  $("studio-layers").replaceChildren();
  const missing = studioMissing();
  $("edit-note").textContent = missing
    ? "Reconnect the original local folders to edit layers. Saved images can still be downloaded."
    : "";
  $("edit-note").hidden = !missing;
  updateStudioActions();
  $("apply-card").textContent = cards.some((c) => c.id === studio.card.id)
    ? "Save changes"
    : "Save to collection";
  [...studio.card.recipe.ops.entries()].reverse().forEach(([index, op]) => {
    const row = el("div", "studio-layer"),
      heading = el("div", "studio-layer-header"),
      tools = el("div", "layer-tools");
    heading.append(el("span", "", categoryLabel(op.layer)));
    for (const [label, action, disabled, title] of [
      [
        "↓",
        () =>
          editRecipe(() => {
            const ops = studio.card.recipe.ops;
            [ops[index - 1], ops[index]] = [ops[index], ops[index - 1]];
          }),
        index === 0 ||
          op.layer === "background" ||
          studio.card.recipe.ops[index - 1]?.layer === "background",
        "Move toward bottom",
      ],
      [
        "↑",
        () =>
          editRecipe(() => {
            const ops = studio.card.recipe.ops;
            [ops[index + 1], ops[index]] = [ops[index], ops[index + 1]];
          }),
        index === studio.card.recipe.ops.length - 1 ||
          op.layer === "background",
        "Move toward top",
      ],
      [
        "×",
        () => editRecipe(() => studio.card.recipe.ops.splice(index, 1)),
        false,
        "Remove layer",
      ],
    ]) {
      const b = button(label, action);
      b.disabled = disabled || missing;
      b.setAttribute("aria-label", `${title}: ${op.name}`);
      tools.append(b);
    }
    heading.append(tools);
    row.append(heading);
    const assets = assetsForPack(allAssets(), studio.card.recipe.pack || settings.pack)
      .filter(a => categoryLayer(a.layer) === categoryLayer(op.layer));
    const picker = el("details", "studio-trait-picker");
    const summary = el("summary", "", op.name);
    summary.setAttribute("aria-label", `Choose trait for ${categoryLabel(op.layer)}: ${op.name}`);
    picker.append(summary);
    let filled = false;
    picker.addEventListener("toggle", () => {
      if (!picker.open || filled) return;
      filled = true;
      const gallery = el("div", "studio-trait-gallery");
      gallery.setAttribute("aria-label", `${categoryLabel(op.layer)} traits`);
      for (const asset of assets) {
        const choice = button("", () => editRecipe(() => {
          Object.assign(op, {assetId:asset.id, name:asset.name, path:asset.path, source:asset.source});
        }), "studio-trait-choice");
        choice.disabled = missing;
        choice.setAttribute("aria-label", `Use ${asset.name}`);
        choice.setAttribute("aria-pressed", String(asset.id === op.assetId));
        const image = el("img");
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        if (asset.file) {
          image.src = URL.createObjectURL(asset.file);
          studioTraitURLs.push(image.src);
        } else image.src = asset.thumbnailUrl || asset.url;
        image.onerror = () => {
          if (asset.thumbnailUrl && image.src === asset.thumbnailUrl) { image.src = asset.url; return; }
          image.hidden = true;
        };
        choice.append(image, el("span", "", asset.name));
        gallery.append(choice);
      }
      if (!assets.length) gallery.append(el("p", "muted", "Reconnect this category’s assets to browse traits."));
      picker.append(gallery);
    });
    row.append(picker);
    const opacity = el("input");
    opacity.type = "range";
    opacity.min = 0;
    opacity.max = 100;
    opacity.value = Math.round(op.opacity * 100);
    opacity.disabled = missing;
    opacity.setAttribute("aria-label", `Opacity for ${op.name}`);
    opacity.onchange = () =>
      run(() => editRecipe(() => (op.opacity = Number(opacity.value) / 100)));
    const fade = el("label", "inline", "Opacity");
    fade.append(opacity);
    row.append(fade);
    const blend = el("select");
    for (const mode of BLEND_MODES) blend.append(option(mode, mode === "source-over" ? "Normal" : mode.replaceAll("-", " ").replace(/^./, c => c.toUpperCase())));
    blend.value = op.blendMode || "source-over";
    blend.disabled = missing;
    blend.setAttribute("aria-label", `Blend mode for ${op.name}`);
    blend.onchange = () => run(() => editRecipe(() => { op.blendMode = blend.value; }));
    const blendLabel = el("label", "inline", "Blend mode");
    blendLabel.append(blend);
    row.append(blendLabel);
    if (op.layer === "sprite" || op.placement === "sprite") {
      const b = button("↻ Reposition", () =>
        editRecipe(() => {
          op.rx = Math.random();
          op.ry = Math.random();
        }),
      );
      b.disabled = missing;
      row.append(b);
    }
    $("studio-layers").append(row);
  });
  $("studio-layers").scrollTop = scrollTop;
  $("add-trait").disabled = missing || studio.card.recipe.ops.length >= 128;
}
async function exportCard(card, dirty = false) {
  const c = await materialize(card, dirty),
    id = safeName(c.id);
  download(
    await zip([
      { name: `${id}.png`, blob: c.png },
      { name: `${id} print assets.png`, blob: c.overlay },
      { name: `${id}.json`, blob: jsonBlob(metadata(c)) },
    ]),
    `${id}.zip`,
  );
}
function syncStudioText() {
  studio.card.name = $("card-name").value.trim() || studio.original.name;
}
function asDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
async function backup() {
  const data = [];
  for (const card of cards) {
    const c = await materialize(card);
    const {localAssets, ...portable} = c;
    data.push({
      ...portable,
      png: await asDataURL(c.png),
      overlay: await asDataURL(c.overlay),
      thumbnail: await asDataURL(c.thumbnail),
    });
  }
  download(
    jsonBlob({
      format: "card-nft-web-backup",
      version: 1,
      created: new Date().toISOString(),
      state: workspace(),
      cards: data,
    }),
    `painting-backup-${new Date().toISOString().slice(0, 10)}.json`,
  );
  toast("Backup downloaded, including saved painting images.");
}
function decodePNG(value) {
  if (
    typeof value !== "string" ||
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
  )
    throw Error("Backup contains an invalid PNG.");
  const bytes = Uint8Array.from(atob(value.split(",")[1]), (c) =>
    c.charCodeAt(0),
  );
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71)
    throw Error("Backup image is not a PNG.");
  return new Blob([bytes], { type: "image/png" });
}
async function restore(file) {
  if (file.size > 500 * 1024 * 1024)
    throw Error("This backup exceeds the 500 MB import limit.");
  const data = JSON.parse(await file.text());
  if (
    data.format !== "card-nft-web-backup" ||
    data.version !== 1 ||
    !Array.isArray(data.cards)
  )
    throw Error("Choose a Web Generator backup JSON file.");
  const ids = new Set();
  const incoming = data.cards.map((c) => {
    validateCard(c);
    delete c.rarity; // Accept old backups while dropping the retired field.
    if (ids.has(c.id)) throw Error("Duplicate painting IDs in backup.");
    ids.add(c.id);
    return {
      ...c,
      png: decodePNG(c.png),
      overlay: decodePNG(c.overlay),
      thumbnail: decodePNG(c.thumbnail),
    };
  });
  const nextState = {
    settings: normalizeSettings(data.state?.settings),
    presets: {},
    useHosted: data.state?.useHosted !== false,
    batch: Number.isSafeInteger(data.state?.batch)
      ? Math.max(batch, data.state.batch)
      : batch,
  };
  for (const [n, p] of Object.entries(data.state?.presets || {}))
    if (n !== "__proto__" && n !== "constructor")
      nextState.presets[n] = normalizeSettings(p);
  if (dbAvailable) await storage.restoreBackup(incoming, nextState);
  checkpoint();
  const merged = new Map(cards.map((c) => [c.id, c]));
  for (const c of incoming) merged.set(c.id, c);
  cards = [...merged.values()];
  settings = nextState.settings;
  presets = nextState.presets;
  useHosted = nextState.useHosted;
  batch = nextState.batch;
  settingsUI();
  assetSummary();
  changeView("collection");
  toast(`Restored ${incoming.length} paintings. Other saved paintings were kept.`);
}

for (const pack of [...PACKS.filter(p => p.id !== "none"), ...PACKS.filter(p => p.id === "none")]) {
  if (pack.id !== "custom")
    $("library-select").append(option(pack.id, pack.name));
  if (pack.id !== "custom")
    $("start-set").append(
      option(pack.id, pack.id === "drifella" ? "Drifella 1" : pack.name),
    );
}
for (const l of LAYERS) {
  if (l !== "sprite") $("add-layer").append(option(l, categoryLabel(l)));
}
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => {
    if (!busy) $(b.dataset.close).close();
  };
$("card-dialog").addEventListener("close", () => {
  releaseStudioTraits();
  hideHoverPreview();
  if (studioURL) URL.revokeObjectURL(studioURL);
  studioURL = null;
  studio = null;
});
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.addEventListener("close", () => {
    if (dialog.contains($("toast"))) {
      $("toast").hidden = true;
      document.body.append($("toast"));
    }
  });
  dialog.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
}
on("picker-tab", () => changeView("picker"));
on("collection-tab", () => changeView("collection"));
on("regenerate", () => generate());
on("undo-button", undo);
on("empty-generate", () =>
  view === "picker" ? generate() : changeView("picker"),
);
on("assets-button", () => {
  assetSummary();
  $("assets-dialog").showModal();
});
on("settings-button", () => {
  settingsUI();
  $("settings-dialog").showModal();
});
// Open file pickers synchronously inside the user gesture.
$("folder-button").onclick = () => {
  if (!busy) $("folder-input").click();
};
$("files-button").onclick = () => {
  if (!busy) $("file-input").click();
};
$("restore-button").onclick = () => {
  if (!busy) $("restore-input").click();
};
on("builtin-sprites-toggle", async () => {
  settings.builtinSprites = !settings.builtinSprites;
  if(settings.builtinSprites) {
    settings.spriteCategoriesEnabled = true;
    settings.enabled["custom:sprites"] = true;
    const order = activeLayers(settings).filter(l=>l!=="custom:sprites");
    const noise=order.findIndex(l=>categoryLabel(l)==="noise");
    order.splice(noise>=0 ? noise : Math.max(0,order.length-1),0,"custom:sprites");
    settings.layerOrders[settings.pack]=order;
  }
  await persistState(); assetSummary(); settingsUI();
});
$("sprite-categories-enabled").onchange = () => run(async () => {
  settings.spriteCategoriesEnabled = $("sprite-categories-enabled").checked;
  await persistState(); settingsUI();
});
on("new-layers-button", () => {
  pendingImages = [];
  $("category-fields").hidden = true;
  $("new-layers-dialog").showModal();
});
$("folder-input").onchange = (e) => run(async () => {
  const files = [...e.target.files];
  e.target.value = "";
  if (files.length) await loadFiles(files, newCategory(files[0].webkitRelativePath.split("/")[0]), $("import-category-type").value === "sprite");
});
$("file-input").onchange = (e) => run(async () => {
  pendingImages = supportedFiles([...e.target.files]);
  e.target.value = "";
  if (!pendingImages.length) throw Error("No supported images selected.");
  $("file-layer").replaceChildren(...activeLayers(settings).map(l => option(l, categoryLabel(l))), option("__new__", "Create a new category…"), option("__sprite__", "Create a new sprite category…"));
  $("pending-images").textContent = `${pendingImages.length} images selected`;
  $("category-fields").hidden = false;
  $("new-category-label").hidden = true;
  $("new-category-name").value = "";
});
$("file-layer").onchange = () => {
  $("new-category-label").hidden = !["__new__", "__sprite__"].includes($("file-layer").value);
};
on("confirm-images", async () => {
  const layer = ["__new__", "__sprite__"].includes($("file-layer").value) ? newCategory($("new-category-name").value) : $("file-layer").value;
  await loadFiles(pendingImages, layer, $("file-layer").value === "__sprite__" || ($("file-layer").value === "__new__" && $("import-category-type").value === "sprite"));
  pendingImages = [];
});
$("restore-input").onchange = (e) =>
  run(async () => {
    if (e.target.files[0]) await restore(e.target.files[0]);
    e.target.value = "";
  });
$("batch-count").onchange = () =>
  run(async () => {
    settings.count = Number($("batch-count").value);
    await persistState();
  });
for (const id of ["search", "sort"])
  $(id).addEventListener("input", () => {
    if (!busy) renderGrid();
  });
for (const [id, key, kind] of [
  ["canvas-width", "width", "number"],
  ["canvas-height", "height", "number"],
  ["canvas-color", "color", "text"],
  ["random-blend", "randomBlend", "bool"],
  ["random-opacity", "randomOpacity", "bool"],
  ["random-order", "randomOrder", "bool"],
])
  $(id).onchange = () =>
    run(async () => {
      settings[key] =
        kind === "bool"
          ? $(id).checked
          : kind === "number"
            ? Number($(id).value)
            : kind === "percent"
              ? Number($(id).value) / 100
              : $(id).value;
      settings = normalizeSettings(settings);
      await persistState();
      settingsUI();
    });
$("start-set").onchange = () =>
  run(async () => {
    settings.pack = $("start-set").value;
    await persistState();
    assetSummary();
    settingsUI();
  });
$("library-select").onchange = () =>
  run(async () => {
    settings.pack = $("library-select").value;
    await persistState();
    assetSummary();
    settingsUI();
    toast("Asset set changed. Generate a new batch to use it.");
  });
on("reset-settings", async () => {
  settings = clone(DEFAULTS);
  await persistState();
  settingsUI();
});
on("save-preset", async () => {
  const name = $("preset-name").value.trim();
  if (!name) throw Error("Give this preset a name.");
  if (["__proto__", "constructor", "prototype"].includes(name))
    throw Error("Please choose a different preset name.");
  presets[name] = clone(settings);
  await persistState();
  $("preset-name").value = "";
  settingsUI();
  toast("Preset saved.");
});
on("add-trait", () =>
  editRecipe(() => {
    const layer = $("add-layer").value,
      options = assetsForPack(
        allAssets(),
        studio.card.recipe.pack || settings.pack,
      ).filter(
        (a) => a.layer === layer && !settings.disabledAssets.includes(a.id),
      );
    if (!options.length) throw Error(`Load some ${layer} assets first.`);
    const a = options[Math.floor(Math.random() * options.length)],
      op = {
        assetId: a.id,
        layer,
        name: a.name,
        originalPath: a.originalPath,
      path: a.path,
        source: a.source,
        rx: Math.random(),
        ry: Math.random(),
        opacity: 1,
      };
    if (settings.spriteCategoriesEnabled && (layer === "custom:sprites" || settings.spriteCategories.includes(layer))) {
      const placed = spriteOps([a], layer, {...settings, spritePlacement:{...settings.spritePlacement,count:[1,1],unique:[1,1]}}, Math.random)[0];
      if (placed) Object.assign(op, placed);
    }
    if (layer === "background") {
      studio.card.recipe.ops = studio.card.recipe.ops.filter(
        (o) => o.layer !== "background",
      );
      studio.card.recipe.ops.unshift(op);
    } else studio.card.recipe.ops.push(op);
  }),
);
on("revert-card", () => {
  studio.card = clone(studio.original);
  studio.dirty = false;
  $("card-name").value = studio.card.name;
  setStudioImage(studio.card.thumbnail || studio.card.png);
  studioLayers();
});
on("apply-card", async () => {
  syncStudioText();
  const saved = await saveCard(studio.card, studio.dirty);
  studio.card = clone(saved);
  studio.original = clone(saved);
  studio.dirty = false;
  $("card-title").textContent = saved.name;
  studioLayers();
});
on("download-card", async () => {
  syncStudioText();
  const c = await materialize(studio.card, studio.dirty);
  download(c.png, `${safeName(c.id)}.png`);
});
on("refresh-rarity", () => { refreshRarity(true); renderGrid(); });
on("backup-button", backup);
const exportFormats = {png:true, print:true, json:true};
for (const format of Object.keys(exportFormats)) {
  on(`download-${format}-toggle`, () => {
    exportFormats[format] = !exportFormats[format];
    $(`download-${format}-toggle`).setAttribute("aria-pressed", exportFormats[format]);
    $("download-collection").disabled = !Object.values(exportFormats).some(Boolean);
  });
}
on("export-all", () => {
  if (!cards.length) throw Error("Save some paintings first.");
  $("download-dialog").showModal();
});
on("download-collection", async () => {
  if (!Object.values(exportFormats).some(Boolean)) return;
  const entries = [];
  for (const card of cards) {
    const c = exportFormats.png || exportFormats.print ? await materialize(card) : card;
    const id = safeName(c.id), folder = id;
    if (exportFormats.png) entries.push({name:`${folder}/${id}.png`,blob:c.png});
    if (exportFormats.print) entries.push({name:`${folder}/${id} print assets.png`,blob:c.overlay});
    if (exportFormats.json) {
      const data = metadata(c);
      data.image = `${id}.png`;
      entries.push({name:`${folder}/${id}.json`,blob:jsonBlob(data)});
    }
  }
  download(await zip(entries), "painting-collection.zip");
  $("download-dialog").close();
});
document.addEventListener("keydown", (e) => {
  if (
    busy ||
    e.repeat ||
    e.metaKey ||
    e.ctrlKey ||
    e.altKey ||
    document.querySelector("dialog[open]") ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)
  )
    return;
  const key = e.key.toLowerCase();
  if (key === "r" && view === "picker") {
    e.preventDefault();
    run(() => generate());
  } else if (key === "u") {
    e.preventDefault();
    run(undo);
  } else if (/^[1-9]$/.test(key) && view === "picker") {
    const card = slots[Number(key) - 1];
    if (!card) return;
    e.preventDefault();
    if (!cards.some((c) => c.id === card.id)) run(() => saveCard(card));
  }
});

let sessionReady = false, sessionTimer;
function uiSnapshot() {
  return {
    view, curateColumns, dialogs: [...document.querySelectorAll("dialog[open]")].map(d => d.id),
    fields: Object.fromEntries(["search", "sort", "asset-search", "card-name", "file-layer", "new-category-name", "import-category-type", "add-layer"].map(id => [id, $(id).value])),
    scroll: {page: window.scrollY, ...Object.fromEntries([...document.querySelectorAll("dialog, #studio-layers")].map(e => [e.id,e.scrollTop]))},
    openFolders: [...openAssetFolders], pages: [...folderPages],
    previewAsset: $("asset-preview-dialog").dataset.assetId,
  };
}
function saveUI() {
  if (!sessionReady) return;
  try { sessionStorage.setItem("painting-ui", JSON.stringify(uiSnapshot())); } catch {}
}
async function saveSession() {
  if (!sessionReady || !dbAvailable) return;
  clearTimeout(sessionTimer);
  saveUI();
  try { await storage.putSession({slots, local, drifellaFiles: [...drifellaFiles], history, studio, pendingImages, ui: uiSnapshot()}); }
  catch { /* Keep the application usable when browser storage is full. */ }
}
function scheduleSession() {
  saveUI();
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => { if (!busy) saveSession(); }, 150);
}
for (const event of ["input", "change", "close", "toggle"]) document.addEventListener(event, scheduleSession, true);
document.addEventListener("scroll", saveUI, true);
window.addEventListener("pagehide", saveUI);
async function restoreSession() {
  if (!dbAvailable) return;
  const saved = await storage.getSession();
  if (!saved) return;
  let ui = saved.ui;
  try { ui = JSON.parse(sessionStorage.getItem("painting-ui")) || ui; } catch {}
  if (!ui) return;
  drifellaFiles = new Map(saved.drifellaFiles || []);
  applyDrifellaFiles();
  slots = saved.slots || [];
  local = saved.local || [];
  history = saved.history || [];
  pendingImages = saved.pendingImages || [];
  for (const layer of ui.openFolders || []) openAssetFolders.add(layer);
  for (const [layer,page] of ui.pages || []) folderPages.set(layer,page);
  for (const [id,value] of Object.entries(ui.fields || {})) if ($(id)) $(id).value = value;
  curateColumns = ui.curateColumns || 3;
  zoomCurate(0);
  assetSummary();
  changeView(ui.view === "collection" ? "collection" : "picker");
  for (const id of ui.dialogs || []) {
    if (id === "card-dialog" && saved.studio) {
      openCard(saved.studio.original);
      studio = saved.studio;
      $("card-name").value = ui.fields?.["card-name"] || studio.card.name;
      if (studio.dirty && !studioMissing()) {
        const blob = await renderBlob(studio.card.recipe, allAssets(), {width:800});
        setStudioImage(blob);
      }
      studioLayers();
    } else if (id === "asset-preview-dialog") {
      const asset = allAssets().find(a => a.id === ui.previewAsset);
      if (asset) {
        $(id).dataset.assetId = asset.id;
        $("asset-preview-title").textContent = asset.name;
        $("asset-preview-image").src = assetURL(asset);
        $("asset-preview-caption").textContent = categoryLabel(asset.layer);
        $("asset-preview-actions").replaceChildren();
        if (asset.source === "local") $("asset-preview-actions").append(button("Unload asset", async () => { await unloadAssets([asset]); $(id).close(); }));
        $(id).showModal();
      }
    } else if ($(id)?.tagName === "DIALOG") $(id).showModal();
  }
  if (pendingImages.length) {
    $("file-layer").replaceChildren(...activeLayers(settings).map(l => option(l, categoryLabel(l))), option("__new__", "Create a new category…"), option("__sprite__", "Create a new sprite category…"));
    $("file-layer").value = ui.fields?.["file-layer"] || activeLayers(settings)[0];
    $("pending-images").textContent = `${pendingImages.length} images selected`;
    $("category-fields").hidden = false;
    $("new-category-label").hidden = !["__new__", "__sprite__"].includes($("file-layer").value);
  }
  await new Promise(requestAnimationFrame);
  for (const [id,top] of Object.entries(ui.scroll || {})) {
    if (id === "page") window.scrollTo(0,top);
    else if ($(id)) $(id).scrollTop = top;
  }
}

async function init() {
  try {
    const state = await storage.getState();
    cards = await storage.allCards();
    for (const card of cards) {
      if ("rarity" in card) {delete card.rarity;await storage.putCard(card);}
    }
    if (state) {
      settings = normalizeSettings(state.settings);
      presets = Object.fromEntries(
        Object.entries(state.presets || {}).map(([n, s]) => [
          n,
          normalizeSettings(s),
        ]),
      );
      useHosted = state.useHosted !== false;
      batch = state.batch || 0;
    }
  } catch (e) {
    dbAvailable = false;
    notice(
      "Browser storage is unavailable. You can still generate and export; download a backup before closing this tab.",
    );
  }
  try {
    await loadHosted();
  } catch (e) {
    notice(e.message);
  }
  settingsUI();
  assetSummary();
  renderGrid();
  $("batch-status").textContent = "Choose an asset set to begin";
  await restoreSession();
  sessionReady = true;
}
run(init);

let curateColumns = 3;
function zoomCurate(delta) {
  curateColumns = Math.max(2, Math.min(10, curateColumns + delta));
  $("grid").style.setProperty("--curate-columns", curateColumns);
  $("zoom-in").disabled = curateColumns === 2;
  $("zoom-out").disabled = curateColumns === 10;
}
on("zoom-in", () => zoomCurate(-1));
on("zoom-out", () => zoomCurate(1));
