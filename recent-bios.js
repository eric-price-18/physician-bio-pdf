/* Local-only storage. Photos use IndexedDB rather than localStorage's small quota. */
(function (root) {
  "use strict";
  const MAX_ITEMS = 20;
  const DB_NAME = "physician-bio-pdf-history";
  const KEY = "physician-bio-pdf:recent:v1";
  const FIELD_IDS = ["nameField", "credentialsField", "specialtyField", "affiliationsField",
    "languagesField", "genderField", "academicTitleField", "backgroundField", "titlesList",
    "educationList", "certificationsList", "membershipsList", "locationsField"];
  const SECTION_KEYS = ["affiliations", "languages", "gender", "titles", "academic", "background",
    "education", "certifications", "memberships", "locations"];

  // Never restore arbitrary URLs, scripts, or unvalidated storage records.
  function validItem(item) {
    return item && item.version === 1 && typeof item.id === "string" && item.id.length > 0 && item.id.length < 100 &&
      typeof item.identity === "string" && item.identity.length > 0 && item.identity.length < 2000 &&
      typeof item.name === "string" && item.name.trim() && item.name.length < 2000 &&
      typeof item.source === "string" && item.source.length <= 1000000 &&
      Number.isFinite(item.updatedAt) && item.updatedAt > 0 && item.updatedAt <= 8640000000000000 &&
      Number.isFinite(item.createdAt) && item.createdAt > 0 && item.createdAt <= 8640000000000000 &&
      FIELD_IDS.every(id => typeof item.fields?.[id] === "string" && item.fields[id].length <= 1000000) &&
      SECTION_KEYS.every(key => typeof item.sections?.[key]?.hidden === "boolean" &&
        typeof item.sections[key].checked === "boolean") &&
      Number.isFinite(item.fontSize) && item.fontSize >= 8 && item.fontSize <= 22 &&
      typeof item.editable === "boolean" && typeof item.photoSrc === "string" &&
      (!item.photoSrc || /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,[a-z\d+/=\s]+$/i.test(item.photoSrc));
  }

  function normalize(items) {
    if (!Array.isArray(items)) throw new Error("Invalid history");
    const seen = new Set();
    // Older parses could save a checkbox that disagreed with the rendered section.
    // Preserve the saved visibility and edit timestamp while repairing the control.
    return items.filter(validItem).map(item => ({ ...item,
      sections: Object.fromEntries(SECTION_KEYS.map(key => [key, {
        hidden: item.sections[key].hidden, checked: !item.sections[key].hidden
      }]))
    })).sort((a, b) => b.updatedAt - a.updatedAt).filter(item => {
      if (seen.has(item.id) || seen.has("identity:" + item.identity)) return false;
      seen.add(item.id);
      seen.add("identity:" + item.identity);
      return true;
    }).slice(0, MAX_ITEMS);
  }

  function createStore(env) {
    let dbPromise;
    let fallback = false;
    let warning = "";
    function database() {
      if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        if (!env.indexedDB) return reject(new Error("IndexedDB unavailable"));
        const request = env.indexedDB.open(DB_NAME, 1);
        let expired = false;
        const timer = setTimeout(() => { expired = true; reject(new Error("Storage unavailable")); }, 2000);
        request.onupgradeneeded = () => request.result.createObjectStore("bios", { keyPath: "id" });
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error("Storage blocked")); };
        request.onsuccess = () => {
          clearTimeout(timer);
          if (expired) { request.result.close(); return; }
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
      });
      return dbPromise;
    }

    function readFallback() {
      const raw = env.localStorage.getItem(KEY);
      if (!raw) return { items: [], deletedIds: [], deletedIdentities: [], clearIndexedDB: false };
      try {
        const data = JSON.parse(raw);
        if (data.version !== 1) throw new Error("Unsupported history");
        const items = normalize(data.items);
        if (items.length !== data.items.length) warning = "Some unreadable recent bios were skipped.";
        return { items, deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds.filter(id => typeof id === "string") : [],
          deletedIdentities: Array.isArray(data.deletedIdentities) ? data.deletedIdentities.filter(id => typeof id === "string") : [],
          clearIndexedDB: data.clearIndexedDB === true };
      } catch (_) {
        warning = "Saved history could not be read. Parse a bio to start a new history.";
        return { items: [], deletedIds: [], deletedIdentities: [], clearIndexedDB: false };
      }
    }

    function changeFallback(state, change, deletion) {
      const items = normalize(change(state.items));
      const deletedIds = new Set(state.deletedIds);
      const deletedIdentities = new Set(state.deletedIdentities);
      if (deletion?.id) {
        deletedIds.add(deletion.id);
        const removed = state.items.find(item => item.id === deletion.id);
        if (removed) deletedIdentities.add(removed.identity);
      }
      items.forEach(item => { deletedIds.delete(item.id); deletedIdentities.delete(item.identity); });
      return { items, deletedIds: [...deletedIds], deletedIdentities: [...deletedIdentities],
        clearIndexedDB: state.clearIndexedDB || !!deletion?.all };
    }

    function writeFallback(state) {
      env.localStorage.setItem(KEY, JSON.stringify({ version: 1, ...state }));
    }

    async function transact(change, deletion) {
      if (!fallback) {
        let db;
        try { db = await database(); }
        catch (_) { fallback = true; }
        if (db) {
          let saved = { items: [], deletedIds: [], deletedIdentities: [], clearIndexedDB: false };
          try { saved = readFallback(); } catch (_) { /* IndexedDB can work when localStorage is blocked. */ }
          const migrate = saved.items.length > 0 || saved.deletedIds.length > 0 || saved.deletedIdentities.length > 0 || saved.clearIndexedDB;
          return new Promise((resolve, reject) => {
            const transaction = db.transaction("bios", change || migrate ? "readwrite" : "readonly");
            const store = transaction.objectStore("bios");
            const request = store.getAll();
            let items;
            request.onsuccess = () => {
              try {
                const primary = normalize(request.result);
                if (primary.length !== request.result.length) warning = "Some unreadable recent bios were skipped.";
                // Reconcile temporary fallback saves and offline deletions on reconnect.
                items = normalize([...saved.items, ...(saved.clearIndexedDB ? [] :
                  primary.filter(item => !saved.deletedIds.includes(item.id) && !saved.deletedIdentities.includes(item.identity)))]);
                if (change) items = normalize(change(items));
                if (deletion && migrate) writeFallback(changeFallback(saved, change, deletion));
                if (change || migrate) {
                  store.clear();
                  items.forEach(item => store.put(item));
                }
              } catch (error) { transaction.abort(); reject(error); }
            };
            transaction.oncomplete = () => {
              if (migrate) {
                try { writeFallback({ items: [], deletedIds: [], deletedIdentities: [], clearIndexedDB: false }); }
                catch (_) { warning = "Recent bios were saved, but temporary browser storage could not be cleaned up."; }
              }
              resolve({ items, warning });
            };
            transaction.onabort = transaction.onerror = () => reject(transaction.error || new Error("History could not be saved"));
          });
        }
      }
      // Fallback is still browser-local. A failed write never destroys older items.
      let saved = readFallback();
      if (change) {
        saved = changeFallback(saved, change, deletion);
        writeFallback(saved);
        warning = "";
      }
      return { items: saved.items, warning };
    }

    return {
      list: () => transact(),
      save: item => {
        if (!validItem(item)) return Promise.reject(new Error("Invalid bio"));
        return transact(items => [item, ...items.filter(old => old.id !== item.id && old.identity !== item.identity)]);
      },
      remove: id => transact(items => items.filter(item => item.id !== id), { id }),
      clear: () => transact(() => [], { all: true }),
      restore: removed => transact(items => [...removed, ...items.filter(item => !removed.some(old => old.id === item.id))])
    };
  }

  const api = { createStore, validItem, normalize, FIELD_IDS, SECTION_KEYS, MAX_ITEMS, DB_NAME, KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecentBios = api;
})(typeof window !== "undefined" ? window : globalThis);
