import { EFFECTS, prepareSource, renderEffect, sampleLayers, seededRandom } from "./effects.js?v=2";

const gallery = document.querySelector("#gallery");
const status = document.querySelector("#status");
const newSamples = document.querySelector("#new-samples");
const reroll = document.querySelector("#reroll");
const jump = document.querySelector("#jump");
const background = document.querySelector("#background");
const detail = document.querySelector("#detail");
const detailCanvas = document.querySelector("#detail-canvas");
const save = document.querySelector("#save");
const assetsURL = new URL("../assets/", import.meta.url);
const effects = [{ id: "original", name: "Originals", description: "The same four layers appear in every row. Click any preview to enlarge." }, ...EFFECTS];
const defaultSamples = [
  "drifs_0000s_0124_0207_SuperSonicGX_1223602892.png",
  "drifs_0000s_0119_0306_NicholasChauLe1995_1033571340.png",
  "drifs_0000s_0116_0341_LilaFelya_626190336.png",
  "drifs_0001s_0013_0001_drunkoak_5676443.png",
];
let filenames = [], samples = [], urls = [], variationSeed = 20261018, busy = false, detailFilename = "";

for (const effect of EFFECTS) {
  const option = document.createElement("option");
  option.value = effect.id; option.textContent = effect.name; jump.append(option);
}
const sampleLetter = index => String.fromCharCode(65 + index);
const recipeSeed = (row, column) => (variationSeed + row * 2654435761 + column * 1013904223) >>> 0;
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
const encode = canvas => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Preview encoding failed")), "image/webp", .94));

function setBusy(value) {
  busy = value; newSamples.disabled = value; reroll.disabled = value || !samples.length;
  gallery.setAttribute("aria-busy", String(value));
}
function showError(error) {
  console.error(error); status.className = "error";
  status.textContent = "Couldn’t finish the gallery. Try New samples again.";
}

async function loadSamples(chosen) {
  const results = await Promise.allSettled(chosen.map(async filename => {
    const response = await fetch(new URL(filename, assetsURL));
    if (!response.ok) throw new Error(`Unable to load ${filename}`);
    const bitmap = await createImageBitmap(await response.blob());
    try { return { filename, bitmap, preview: prepareSource(bitmap) }; }
    catch (error) { bitmap.close(); throw error; }
  }));
  const failed = results.find(result => result.status === "rejected");
  if (failed) {
    results.forEach(result => { if (result.status === "fulfilled") result.value.bitmap.close(); });
    throw failed.reason;
  }
  samples.forEach(sample => sample.bitmap.close());
  samples = results.map(result => result.value);
}

async function renderGallery() {
  urls.forEach(url => URL.revokeObjectURL(url)); urls = [];
  gallery.replaceChildren(); status.className = "";
  const cards = [];
  for (const [row, effect] of effects.entries()) {
    const section = document.createElement("section"); section.className = "effect-section"; section.id = effect.id;
    const heading = document.createElement("div"); heading.className = "effect-heading";
    const title = document.createElement("h2"), number = document.createElement("span");
    number.className = "effect-number"; number.textContent = row ? String(row).padStart(2, "0") : "00";
    title.append(number, effect.name);
    const description = document.createElement("p"); description.textContent = effect.description;
    heading.append(title, description);
    const grid = document.createElement("div"); grid.className = "sample-grid";
    for (const [column, sample] of samples.entries()) {
      const button = document.createElement("button"); button.type = "button"; button.className = "sample"; button.disabled = true;
      button.setAttribute("aria-label", `${effect.name}, sample ${sampleLetter(column)}. View full resolution.`);
      const art = document.createElement("span"); art.className = "sample-art";
      const image = document.createElement("img"); image.width = 466; image.height = 503;
      image.alt = `${effect.name} on ${sample.filename}`; image.decoding = "async"; image.loading = row > 1 ? "lazy" : "eager";
      art.append(image);
      const label = document.createElement("span"); label.className = "sample-label";
      const name = document.createElement("span"); name.textContent = `Sample ${sampleLetter(column)}`;
      const enlarge = document.createElement("span"); enlarge.textContent = "↗";
      label.append(name, enlarge); button.append(art, label); grid.append(button);
      const seed = recipeSeed(row, column);
      button.addEventListener("click", () => openDetail(effect, sample, column, seed));
      cards.push({ effect, sample, seed, image, button });
    }
    section.append(heading, grid); gallery.append(section);
  }
  for (const [index, card] of cards.entries()) {
    const output = renderEffect(card.sample.preview, card.effect.id, card.seed);
    const url = URL.createObjectURL(await encode(output)); urls.push(url);
    card.image.src = url; card.button.disabled = false;
    status.textContent = index < 4 ? "Preparing originals…" : `${index - 3} / 80 previews`;
    if (index % 4 === 3) await nextTask();
  }
  status.textContent = "80 previews · ready";
}

function openDetail(effect, sample, column, seed) {
  try {
    const source = prepareSource(sample.bitmap, 932, 1006);
    const rendered = renderEffect(source, effect.id, seed);
    const ctx = detailCanvas.getContext("2d"); ctx.clearRect(0, 0, 932, 1006); ctx.drawImage(rendered, 0, 0);
    detailCanvas.setAttribute("aria-label", `${effect.name} on sample ${sampleLetter(column)}`);
    document.querySelector("#detail-title").textContent = `${effect.name} · Sample ${sampleLetter(column)}`;
    document.querySelector("#detail-source").textContent = sample.filename;
    detailFilename = `dratinis-${effect.id}-${sampleLetter(column)}-${seed}.png`;
    detail.showModal();
  } catch (error) { showError(error); }
}
document.querySelector("#close").addEventListener("click", () => detail.close());
detail.addEventListener("click", event => { if (event.target === detail) detail.close(); });
save.addEventListener("click", async () => {
  save.disabled = true;
  try {
    const filename = detailFilename;
    const blob = await new Promise(resolve => detailCanvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Unable to encode PNG");
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { showError(error); }
  finally { save.disabled = false; }
});
background.addEventListener("input", () => document.documentElement.style.setProperty("--preview", background.value));
jump.addEventListener("change", () => document.getElementById(jump.value)?.scrollIntoView({ block: "start" }));

async function generate(changeSamples, initial = false) {
  if (busy) return;
  setBusy(true); status.className = "";
  try {
    if (!filenames.length) {
      const response = await fetch(new URL("manifest.json", assetsURL));
      if (!response.ok) throw new Error("Unable to load sample library");
      filenames = (await response.json()).images;
      if (!Array.isArray(filenames) || filenames.length < 4) { filenames = []; throw new Error("Four sample layers are required"); }
    }
    if (changeSamples) {
      status.textContent = "Loading samples…";
      const chosen = initial && defaultSamples.every(filename => filenames.includes(filename))
        ? defaultSamples : sampleLayers(filenames, 4, initial ? seededRandom(20261018) : Math.random);
      await loadSamples(chosen);
    }
    if (!initial) variationSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    await renderGallery();
  } catch (error) { showError(error); }
  finally { setBusy(false); }
}
newSamples.addEventListener("click", () => generate(true));
reroll.addEventListener("click", () => generate(false));
generate(true, true);
