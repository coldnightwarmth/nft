let dbPromise;
function db() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("card-nft-web-generator", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("cards", { keyPath: "id" });
      req.result.createObjectStore("state");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
async function transact(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    let result;
    try {
      const req = fn(tx.objectStore(store));
      if (req)
        req.onsuccess = () => {
          result = req.result;
        };
    } catch (e) {
      tx.abort();
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Storage transaction aborted"));
  });
}
export const allCards = () => transact("cards", "readonly", (s) => s.getAll());
export const putCard = (card) =>
  transact("cards", "readwrite", (s) => s.put(card));
export const removeCard = (id) =>
  transact("cards", "readwrite", (s) => s.delete(id));
export const getState = () =>
  transact("state", "readonly", (s) => s.get("workspace"));
export const putState = (state) =>
  transact("state", "readwrite", (s) => s.put(state, "workspace"));
export async function restoreBackup(cards, state) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(["cards", "state"], "readwrite");
    for (const card of cards) tx.objectStore("cards").put(card);
    tx.objectStore("state").put(state, "workspace");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Import aborted"));
  });
}
export const replaceCards = (cards) =>
  transact("cards", "readwrite", (s) => {
    s.clear();
    for (const card of cards) s.put(card);
  });
export async function replaceWorkspace(cards, state) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(["cards", "state"], "readwrite");
    const store = tx.objectStore("cards");
    store.clear();
    for (const card of cards) store.put(card);
    tx.objectStore("state").put(state, "workspace");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error("Undo aborted"));
  });
}
