import { createFavoritesStore, FAVORITES_LIMIT, favoriteKey, favoriteArchiveEntries } from "./favorites-store.js?v=1";
import { zip } from "../js/zip.js?v=favorites-1";

function encode(canvas, type = "image/png") {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("The favorite image couldn’t be saved.")), type));
}

export function createFavorites({ canvas, foreground, getMetadata, recall, downloadFile, closeEffects, reportError }) {
  const star = document.querySelector("#favorite-star");
  const opener = document.querySelector("#favorites-button");
  const panel = document.querySelector("#favorites-panel");
  const grid = document.querySelector("#favorites-grid");
  const counter = document.querySelector("#favorites-count");
  const message = document.querySelector("#favorites-message");
  const exportButton = document.querySelector("#favorites-download");
  const closeButton = document.querySelector("#favorites-close");
  const store = createFavoritesStore();
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("dratinis-favorites") : null;
  let items = [], ready = false, saving = false, exporting = false, recalling = false;
  let thumbnailURLs = [], refreshVersion = 0;

  function selected() {
    const metadata = getMetadata();
    const key = metadata && favoriteKey(metadata);
    return key && items.find(item => item.key === key);
  }

  function update() {
    const current = selected();
    star.disabled = !ready || !getMetadata() || saving;
    star.setAttribute("aria-pressed", String(Boolean(current)));
    star.setAttribute("aria-label", current ? "Unstar current generation" : "Star current generation");
    star.title = saving ? "Saving favorite…" : current ? "Remove this favorite" : "Favorite this generation";
    counter.textContent = `${items.length} / ${FAVORITES_LIMIT}`;
    opener.title = `Favorites · ${items.length} saved`;
    opener.setAttribute("aria-label", `Open favorites (${items.length} saved)`);
    exportButton.disabled = !ready || !items.length || exporting || saving;
    if (!exporting) exportButton.textContent = "Download all · ZIP";
    for (const button of grid.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === current?.id));
      button.disabled = recalling;
    }
  }

  function position() {
    if (panel.hidden) return;
    const anchor = opener.getBoundingClientRect();
    panel.style.maxHeight = `${Math.max(100, Math.min(430, anchor.top - 20))}px`;
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(anchor.right - box.width, document.documentElement.clientWidth - box.width - 12))}px`;
    panel.style.top = `${Math.max(8, anchor.top - box.height - 8)}px`;
  }

  function releaseThumbnails() {
    for (const url of thumbnailURLs) URL.revokeObjectURL(url);
    thumbnailURLs = [];
    grid.replaceChildren();
  }

  function close(restoreFocus = false) {
    panel.hidden = true;
    opener.setAttribute("aria-expanded", "false");
    releaseThumbnails();
    if (restoreFocus) opener.focus();
  }

  function errorMessage(error) {
    const text = error.name === "QuotaExceededError" ? "Browser storage is full. Download your favorites, then unstar some to make room." : error.message || "Favorites couldn’t be saved in this browser.";
    message.textContent = text;
    message.hidden = false;
    position();
    reportError(text);
  }

  function drawGallery() {
    releaseThumbnails();
    if (panel.hidden) return;
    message.textContent = "";
    message.hidden = true;
    items.forEach((item, index) => {
      const layerLabel = `${item.layerCount} ${item.layerCount === 1 ? "layer" : "layers"}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "favorite-tile";
      button.dataset.id = item.id;
      button.setAttribute("aria-label", `Recall favorite ${index + 1}, ${layerLabel}`);
      button.title = `${layerLabel} · ${new Date(item.savedAt).toLocaleString()}`;
      const image = document.createElement("img");
      image.src = URL.createObjectURL(item.thumbnail);
      thumbnailURLs.push(image.src);
      image.alt = "";
      image.loading = "lazy";
      image.width = 148;
      image.height = 160;
      const caption = document.createElement("span");
      caption.textContent = layerLabel;
      button.append(image, caption);
      button.addEventListener("click", async () => {
        if (recalling) return;
        if (selected()?.id === item.id) { close(true); return; }
        recalling = true;
        grid.setAttribute("aria-busy", "true");
        update();
        try {
          if (await recall(() => store.get(item.id))) close(true);
        } catch (error) { errorMessage(error); }
        finally { recalling = false; grid.setAttribute("aria-busy", "false"); update(); }
      });
      grid.append(button);
    });
    update();
    position();
  }

  async function refresh() {
    const version = ++refreshVersion;
    const latest = await store.list();
    if (version !== refreshVersion) return;
    items = latest;
    ready = true;
    drawGallery();
    update();
  }

  star.addEventListener("click", async () => {
    if (!ready || saving) return;
    const metadata = getMetadata();
    if (!metadata) return;
    saving = true;
    update();
    try {
      const current = selected();
      if (current) await store.remove(current.id);
      else {
        if (items.length >= FAVORITES_LIMIT) throw Error("You have 500 favorites. Unstar one to make room.");
        const thumbnail = document.createElement("canvas");
        thumbnail.width = 148;
        thumbnail.height = 160;
        thumbnail.getContext("2d").drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
        // All three encodes snapshot synchronously, before the next generation can paint.
        const [png, transparent, preview] = await Promise.all([encode(canvas), encode(foreground), encode(thumbnail, "image/webp")]);
        await store.add({ id: crypto.randomUUID(), savedAt: metadata.exportedAt, metadata, png, foreground: transparent, thumbnail: preview });
      }
      await refresh();
      channel?.postMessage("changed");
    } catch (error) { errorMessage(error); }
    finally { saving = false; update(); }
  });

  opener.addEventListener("click", () => {
    if (!panel.hidden) { close(true); return; }
    closeEffects();
    panel.hidden = false;
    opener.setAttribute("aria-expanded", "true");
    drawGallery();
    closeButton.focus();
    refresh().catch(errorMessage);
  });
  closeButton.addEventListener("click", () => close(true));
  document.addEventListener("pointerdown", event => {
    if (!panel.hidden && !panel.contains(event.target) && !opener.contains(event.target)) close();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) { event.preventDefault(); close(true); }
  });
  window.addEventListener("resize", position);
  window.addEventListener("focus", () => refresh().catch(errorMessage));
  if (channel) channel.onmessage = () => refresh().catch(errorMessage);

  exportButton.addEventListener("click", async () => {
    if (exporting || saving || !items.length) return;
    exporting = true;
    update();
    const collection = [...items];
    exportButton.textContent = `Preparing 0 / ${collection.length}…`;
    try {
      const entries = favoriteArchiveEntries(collection, id => store.get(id), (done, total) => { exportButton.textContent = `Preparing ${done} / ${total}…`; });
      downloadFile(await zip(entries), `dratinis-favorites-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`);
    } catch (error) { errorMessage(error); }
    finally { exporting = false; update(); }
  });

  refresh().catch(errorMessage);
  update();
  return { update, close };
}
