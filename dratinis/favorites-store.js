export const FAVORITES_LIMIT = 500;

export function favoriteKey(metadata) {
  return JSON.stringify([
    metadata.canvas.width, metadata.canvas.height, metadata.canvas.background.toLowerCase(),
    metadata.layers.map(({ filename, effect }) => [filename, effect?.type ?? null, effect?.seed ?? null]),
  ]);
}

export function createFavoritesStore(name = "dratinis-favorites") {
  let connection;
  function open() {
    return connection ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const summaries = request.result.createObjectStore("summaries", { keyPath: "id" });
        summaries.createIndex("key", "key", { unique: true });
        request.result.createObjectStore("artwork", { keyPath: "id" });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => { connection = null; reject(request.error); };
    });
  }
  async function transact(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["summaries", "artwork"], mode);
      let result, failure;
      const fail = error => { failure = error; transaction.abort(); };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || transaction.error || Error("Favorites storage was interrupted."));
      transaction.onerror = () => {};
      try {
        work(transaction.objectStore("summaries"), transaction.objectStore("artwork"), value => { result = value; }, fail);
      } catch (error) { fail(error); }
    });
  }
  return {
    async list() {
      const items = await transact("readonly", (summaries, _, done) => {
        summaries.getAll().onsuccess = event => done(event.target.result);
      });
      return items.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
    },
    get: id => transact("readonly", (_, artwork, done) => {
      artwork.get(id).onsuccess = event => done(event.target.result);
    }),
    add: record => transact("readwrite", (summaries, artwork, done, fail) => {
      // Check duplicates and capacity in the same transaction, including across tabs.
      const key = favoriteKey(record.metadata);
      summaries.index("key").getKey(key).onsuccess = event => {
        if (event.target.result) { done(event.target.result); return; }
        summaries.count().onsuccess = event => {
          if (event.target.result >= FAVORITES_LIMIT) {
            fail(Error("You have 500 favorites. Unstar one to make room."));
            return;
          }
          summaries.add({ id: record.id, key, savedAt: record.savedAt, thumbnail: record.thumbnail, layerCount: record.metadata.layerCount });
          const { thumbnail, ...full } = record;
          artwork.add(full);
          done(record.id);
        };
      };
    }),
    remove: id => transact("readwrite", (summaries, artwork) => { summaries.delete(id); artwork.delete(id); }),
    async close() { if (connection) (await connection).close(); connection = null; },
  };
}

export async function* favoriteArchiveEntries(favorites, getFavorite, onProgress = () => {}) {
  for (let index = 0; index < favorites.length; index++) {
    const record = await getFavorite(favorites[index].id);
    if (!record) throw Error("A favorite was removed during export. Please try again.");
    const filename = `dratini-${String(index + 1).padStart(3, "0")}-${record.id}`;
    yield { name: `${filename}.png`, blob: record.png };
    yield { name: `jsons/${filename}.json`, blob: new Blob([JSON.stringify(record.metadata, null, 2) + "\n"], { type: "application/json" }) };
    onProgress(index + 1, favorites.length);
  }
}
