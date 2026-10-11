/* Local-only storage. Photos use IndexedDB rather than localStorage's small quota. */
(function (root) {
  "use strict";
  const MAX_ITEMS = 20;
  const DB_NAME = "physician-bio-pdf-history";
  const KEY = "physician-bio-pdf:recent:v1";
  // Keep the original storage ID when the owner renames the department.
  const DEPARTMENTS = [{ id: "front-desk", name: "Cath Lab" }];
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

  function normalize(items, limit = MAX_ITEMS) {
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
    }).slice(0, limit);
  }

  function createStore(env) {
    return createCollectionStore(env, DB_NAME, KEY, MAX_ITEMS);
  }

  function createDepartmentStore(env, id, presets = []) {
    if (!DEPARTMENTS.some(department => department.id === id)) throw new Error("Unknown department");
    // A separate database and fallback key prevent history eviction, clear, and
    // fallback tombstones from ever touching permanent department copies.
    const store = createCollectionStore(env, "physician-bio-pdf-department-" + id,
      "physician-bio-pdf:department:" + id + ":v1", Infinity);
    if (!Array.isArray(presets) || presets.some(item => !validItem(item) || item.departmentRemoved)) throw new Error("Invalid department presets");
    const defaults = normalize(presets, Infinity);
    if (defaults.length !== presets.length) throw new Error("Duplicate department presets");
    function withPresets(result) {
      // Stored edits and removal markers always win, even if a later catalog
      // release has newer timestamps. Never overwrite a user's saved choices.
      const items = normalize([...result.items, ...defaults.filter(preset =>
        !result.items.some(item => item.id === preset.id || item.identity === preset.identity))], Infinity);
      return { ...result, items: items.filter(item => !item.departmentRemoved) };
    }
    function removalMarker(item) {
      // Remember removal without keeping the deleted source or photo on disk.
      return { version: 1, id: item.id, identity: item.identity, name: "Removed bio", source: "",
        createdAt: item.createdAt, updatedAt: Date.now(), photoSrc: "", fontSize: 14, editable: false,
        fields: Object.fromEntries(FIELD_IDS.map(key => [key, ""])),
        sections: Object.fromEntries(SECTION_KEYS.map(key => [key, { hidden: true, checked: false }])),
        departmentRemoved: true };
    }
    const list = async () => withPresets(await store.list());
    return {
      list,
      save: async item => withPresets(await store.save({ ...item, departmentRemoved: false })),
      remove: async id => {
        const result = await list();
        const item = result.items.find(item => item.id === id);
        return item ? withPresets(await store.save(removalMarker(item))) : result;
      },
      clear: async () => withPresets(await store.restore((await list()).items.map(removalMarker))),
      restore: async items => withPresets(await store.restore(items.map(item => ({ ...item, departmentRemoved: false }))))
    };
  }

  function createCollectionStore(env, dbName, key, limit) {
    const normalizeItems = items => normalize(items, limit);
    let dbPromise;
    let fallback = false;
    let warning = "";
    function database() {
      if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
        if (!env.indexedDB) return reject(new Error("IndexedDB unavailable"));
        const request = env.indexedDB.open(dbName, 1);
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
      const raw = env.localStorage.getItem(key);
      if (!raw) return { items: [], deletedIds: [], deletedIdentities: [], clearIndexedDB: false };
      try {
        const data = JSON.parse(raw);
        if (data.version !== 1) throw new Error("Unsupported history");
        const items = normalizeItems(data.items);
        if (items.length !== data.items.length) warning = "Some unreadable saved bios were skipped.";
        return { items, deletedIds: Array.isArray(data.deletedIds) ? data.deletedIds.filter(id => typeof id === "string") : [],
          deletedIdentities: Array.isArray(data.deletedIdentities) ? data.deletedIdentities.filter(id => typeof id === "string") : [],
          clearIndexedDB: data.clearIndexedDB === true };
      } catch (_) {
        warning = "Saved bios could not be read in this browser.";
        return { items: [], deletedIds: [], deletedIdentities: [], clearIndexedDB: false };
      }
    }

    function changeFallback(state, change, deletion) {
      const items = normalizeItems(change(state.items));
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
      env.localStorage.setItem(key, JSON.stringify({ version: 1, ...state }));
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
                const primary = normalizeItems(request.result);
                if (primary.length !== request.result.length) warning = "Some unreadable saved bios were skipped.";
                // Reconcile temporary fallback saves and offline deletions on reconnect.
                items = normalizeItems([...saved.items, ...(saved.clearIndexedDB ? [] :
                  primary.filter(item => !saved.deletedIds.includes(item.id) && !saved.deletedIdentities.includes(item.identity)))]);
                if (change) items = normalizeItems(change(items));
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
                catch (_) { warning = "Bios were saved, but temporary browser storage could not be cleaned up."; }
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

  // Bundled department presets never read or write browser storage. Existing local
  // copies remain untouched; each read returns a detached snapshot for preview use.
  function presetNameParts(item) {
    // Prefer explicit structured names when a future preset provides them.
    // Display names use "Given Family, credentials"; omit titles and suffixes.
    const display = item.name.split(",")[0].trim().replace(/^(?:Dr\.?|Professor)\s+/i, "");
    const words = display.split(/\s+/);
    const suffix = /^(?:MD|M\.D\.|DO|D\.O\.|PhD|BMBCh|MBBS|MBChB|FACC|FRCP|Jr\.?|Sr\.?|II|III|IV)$/i;
    while (words.length > 1 && suffix.test(words[words.length - 1])) words.pop();
    return [item.lastName?.trim() || words.at(-1) || "",
      item.firstName?.trim() || words.slice(0, -1).join(" "), display];
  }

  function comparePresetNames(a, b) {
    const left = presetNameParts(a), right = presetNameParts(b);
    for (let index = 0; index < left.length; index++) {
      const order = left[index].localeCompare(right[index], "en", { sensitivity: "base", numeric: true });
      if (order) return order;
    }
    return a.id.localeCompare(b.id, "en");
  }

  function createPresetStore(defaults = []) {
    const items = JSON.stringify(normalize(defaults, Infinity).sort(comparePresetNames));
    return Object.freeze({ list: async () => ({ items: JSON.parse(items), warning: "" }) });
  }

  const api = { createPresetStore, createStore, createDepartmentStore, DEPARTMENTS, validItem, normalize, FIELD_IDS, SECTION_KEYS, MAX_ITEMS, DB_NAME, KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RecentBios = api;
})(typeof window !== "undefined" ? window : globalThis);
