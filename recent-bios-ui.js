/* Save completed previews, not the unparsed contents of the input box. */
(function () {
  "use strict";
  const history = RecentBios.createStore(window);
  const collections = new Map([["recent", { name: "Recent bios", store: history, items: [], removed: [], loaded: false }],
    ...RecentBios.DEPARTMENTS.map(department => [department.id, {
      name: department.name, store: RecentBios.createPresetStore(window.DepartmentBios?.[department.id] || []), items: [], removed: [], loaded: false
    }])]);
  const list = document.getElementById("recentBiosList");
  const empty = document.getElementById("recentBiosEmpty");
  const status = document.getElementById("recentBiosStatus");
  const clearRecent = document.getElementById("clearRecentBtn");
  const undo = document.getElementById("undoRecentBtn");
  const tabs = document.getElementById("bioTabs");
  const panel = document.getElementById("bioCollectionPanel");
  let selectedCollection = "recent";
  let activeCollection = "recent";
  let clearPending = false;
  let active = null;
  let saveTimer;
  let queue = Promise.resolve();
  let restoring = false;
  let cachedPhotoSource = "";
  let cachedPhoto = "";
  let photoSource = "";
  let displayedIdentity = "";
  let pressedAction = null;
  let renderDeferred = false;

  RecentBios.DEPARTMENTS.forEach(department => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = "bio-tab-" + department.id;
    tab.dataset.collection = department.id;
    tab.textContent = department.name;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", panel.id);
    tab.tabIndex = -1;
    tabs.appendChild(tab);
  });

  function updateControls() {
    const collection = collections.get(selectedCollection);
    clearRecent.disabled = selectedCollection !== "recent" || !collection.items.length || clearPending;
    undo.hidden = selectedCollection !== "recent" || !collection.removed.length;
  }

  function selectCollection(id) {
    if (!collections.has(id)) return;
    selectedCollection = id;
    tabs.querySelectorAll('[role="tab"]').forEach(tab => {
      const selected = tab.dataset.collection === id;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) panel.setAttribute("aria-labelledby", tab.id);
    });
    status.textContent = "";
    pressedAction = null;
    renderDeferred = false;
    render();
    list.scrollTop = 0;
  }

  tabs.addEventListener("click", event => {
    const tab = event.target.closest('[role="tab"]');
    if (tab) selectCollection(tab.dataset.collection);
  });
  tabs.addEventListener("keydown", event => {
    const allTabs = [...tabs.querySelectorAll('[role="tab"]')];
    const index = allTabs.indexOf(event.target);
    if (index < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? allTabs.length - 1 :
      (index + (event.key === "ArrowRight" ? 1 : -1) + allTabs.length) % allTabs.length;
    selectCollection(allTabs[next].dataset.collection);
    allTabs[next].focus();
    allTabs[next].scrollIntoView({ block: "nearest", inline: "nearest" });
  });

  // Keep useful editing markup, never event handlers or executable HTML from storage/paste.
  function safeHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    const allowed = new Set(["BR", "DIV", "P", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "U", "SPAN"]);
    function copy(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent);
      const fragment = document.createDocumentFragment();
      if (node.nodeType !== Node.ELEMENT_NODE || /^(SCRIPT|STYLE|IFRAME|OBJECT|SVG|MATH|TEMPLATE)$/.test(node.tagName)) return fragment;
      const result = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : fragment;
      // Preserve the indent in generated location addresses.
      if (node.tagName === "SPAN" && node.style.marginLeft === "10px") result.style.marginLeft = "10px";
      node.childNodes.forEach(child => result.appendChild(copy(child)));
      return result;
    }
    const container = document.createElement("div");
    template.content.childNodes.forEach(node => container.appendChild(copy(node)));
    return container.innerHTML;
  }

  function updateRecentListHeight() {
    const firstFour = Array.from(list.children).slice(0, 4);
    list.style.maxHeight = firstFour.reduce((height, row) => height + row.getBoundingClientRect().height, 0) + "px";
  }

  function render() {
    updateControls();
    // Autosave can finish between pointerdown and click. Keep that button alive.
    if (pressedAction) { renderDeferred = true; return; }
    const focused = document.activeElement;
    const focusId = focused?.dataset.bioId;
    const focusAction = focused?.dataset.action;
    list.replaceChildren();
    const collectionId = selectedCollection;
    const collection = collections.get(collectionId);
    collection.items.forEach(item => {
      const row = document.createElement("li");
      row.className = "recent-bio";
      const details = document.createElement("div");
      details.className = "recent-bio-details";
      const name = document.createElement("strong");
      name.className = "recent-bio-name";
      name.textContent = item.name;
      const date = document.createElement("time");
      date.className = "recent-bio-date";
      date.dateTime = new Date(item.updatedAt).toISOString();
      date.textContent = "Updated " + new Date(item.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      details.append(name, date);
      const actions = document.createElement("div");
      actions.className = "recent-bio-actions";
      (collectionId === "recent" ? ["Open", "Delete"] : ["Open"]).forEach(action => {
        const button = document.createElement("button");
        button.textContent = action;
        button.dataset.bioId = item.id;
        button.dataset.action = action;
        button.setAttribute("aria-label", action + " " + item.name);
        if (action === "Delete") button.className = "ghost";
        button.addEventListener("click", () => action === "Open" ? openBio(item.id, collectionId) : removeBio(item.id, collectionId));
        actions.appendChild(button);
      });
      row.append(details, actions);
      list.appendChild(row);
    });
    updateRecentListHeight();
    empty.hidden = collection.items.length > 0;
    empty.textContent = collectionId === "recent" ? "No recent bios yet. Parse a bio to save it here." :
      "No preset bios in " + collection.name + " yet.";
    if (focusId) {
      const buttons = Array.from(list.querySelectorAll("button"));
      (buttons.find(button => button.dataset.bioId === focusId && button.dataset.action === focusAction) ||
        buttons[0] || (undo.hidden ? panel : undo)).focus();
    }
  }

  list.addEventListener("pointerdown", event => {
    const button = event.target.closest("button");
    if (button && list.contains(button)) pressedAction = { pointerId: event.pointerId };
  });
  function releaseAction(event) {
    const pressed = pressedAction;
    if (!pressed || ((event.type === "pointerup" || event.type === "pointercancel") && event.pointerId !== pressed.pointerId)) return;
    // The compatibility click follows pointerup; redraw on the next frame.
    requestAnimationFrame(() => {
      if (pressedAction !== pressed) return;
      pressedAction = null;
      if (renderDeferred) { renderDeferred = false; render(); }
    });
  }
  document.addEventListener("pointerup", releaseAction);
  document.addEventListener("pointercancel", releaseAction);
  window.addEventListener("blur", releaseAction);
  list.addEventListener("click", releaseAction);
  list.addEventListener("focusout", event => {
    if (!list.contains(event.relatedTarget)) releaseAction(event);
  });

  function enqueue(operation, message, collectionId = "recent") {
    queue = queue.then(async () => {
      const result = await operation();
      if (!result) return;
      const collection = collections.get(collectionId);
      collection.items = result.items;
      collection.loaded = true;
      if (selectedCollection === collectionId) status.textContent = result.warning || message || "";
      render();
    }).catch(() => {
      status.textContent = collections.get(collectionId).name + " could not be saved on this browser. Storage may be full or unavailable. Your current preview and PDF still work.";
    });
    return queue;
  }

  function capture() {
    if (!active) return null;
    const fields = {};
    RecentBios.FIELD_IDS.forEach(id => { fields[id] = safeHtml(document.getElementById(id).innerHTML); });
    const sections = {};
    document.querySelectorAll(".field").forEach(field => {
      sections[field.dataset.field] = {
        hidden: field.classList.contains("hidden"), checked: field.querySelector(".section-toggle").checked
      };
    });
    return {
      ...active, version: 1, updatedAt: Date.now(),
      name: document.getElementById("nameField").textContent.trim() || "Untitled bio",
      fields, sections, photoSrc: storedPhoto(),
      fontSize: Number(fontSizeSlider.value), editable: editToggle.checked
    };
  }

  function storedPhoto() {
    // A photo pasted for the next input must not overwrite the previous saved bio.
    if (photoSource && clean(photoSource) !== clean(active.source)) {
      return collections.get(activeCollection).items.find(item => item.id === active.id)?.photoSrc || "";
    }
    const source = photoImg.dataset.placeholder === "true" || photoImg.style.display === "none" ? "" : (photoImg.getAttribute("src") || "");
    if (!source) return "";
    if (source === cachedPhotoSource) return cachedPhoto;
    // Keep the full original in the current PDF preview. Bound only the saved copy
    // of very large uploads, and rasterize formats that shouldn't be restored as markup.
    const raster = /^data:image\/(png|jpeg|jpg|webp|gif|bmp);base64,/i.test(source);
    let saved = source;
    if (!raster || source.length > 2000000) {
      if (!photoImg.complete || !photoImg.naturalWidth) return "";
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1600 / Math.max(photoImg.naturalWidth, photoImg.naturalHeight));
      canvas.width = Math.max(1, Math.round(photoImg.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(photoImg.naturalHeight * scale));
      canvas.getContext("2d").drawImage(photoImg, 0, 0, canvas.width, canvas.height);
      saved = canvas.toDataURL("image/png");
    }
    cachedPhotoSource = source;
    cachedPhoto = saved;
    return saved;
  }

  function sameSnapshot(previous, snapshot) {
    return previous.identity === snapshot.identity && previous.source === snapshot.source && previous.name === snapshot.name &&
      previous.photoSrc === snapshot.photoSrc && previous.fontSize === snapshot.fontSize && previous.editable === snapshot.editable &&
      RecentBios.FIELD_IDS.every(id => previous.fields[id] === snapshot.fields[id]) &&
      RecentBios.SECTION_KEYS.every(key => previous.sections[key].hidden === snapshot.sections[key].hidden &&
        previous.sections[key].checked === snapshot.sections[key].checked);
  }

  function saveActive() {
    clearTimeout(saveTimer);
    // Preset previews are transient. Never save edits back to their collection.
    if (restoring || activeCollection !== "recent") return queue;
    let snapshot;
    try { snapshot = capture(); }
    catch (_) { status.textContent = "This bio could not be saved. Your current preview and PDF still work."; return queue; }
    if (!snapshot) return queue;
    const collectionId = activeCollection;
    const collection = collections.get(collectionId);
    const previous = collection.items.find(item => item.id === snapshot.id);
    if (previous && sameSnapshot(previous, snapshot)) return queue;
    return enqueue(() => collection.store.save(snapshot), "", collectionId);
  }

  function scheduleSave() {
    if (!active || restoring || activeCollection !== "recent") return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveActive, 450);
  }

  async function openBio(id, collectionId) {
    await saveActive();
    const item = collections.get(collectionId).items.find(item => item.id === id);
    if (!item) return;
    restoring = true;
    activeCollection = collectionId;
    active = { id: item.id, identity: item.identity, source: item.source, createdAt: item.createdAt };
    displayedIdentity = item.identity;
    rawInput.value = item.source;
    // The edited preview is authoritative; parsing the old source would discard edits.
    RecentBios.FIELD_IDS.forEach(fieldId => { document.getElementById(fieldId).innerHTML = safeHtml(item.fields[fieldId]); });
    document.getElementById("credentialsField").style.display = "none";
    document.querySelectorAll(".field").forEach(field => {
      const section = item.sections[field.dataset.field];
      setSectionVisible(field, !section.hidden);
    });
    photoFileInput.value = "";
    photoSource = item.source;
    if (item.photoSrc) setPhotoSrc(item.photoSrc);
    else showPhotoPlaceholder();
    fontSizeSlider.value = item.fontSize;
    fontSizeSlider.dispatchEvent(new Event("input"));
    editToggle.checked = item.editable;
    editToggle.dispatchEvent(new Event("change"));
    restoring = false;
    updateControls();
    ensureBackgroundClears();
    document.getElementById("nameField").setAttribute("tabindex", "-1");
    document.getElementById("nameField").focus({ preventScroll: true });
    document.querySelector(".preview-controls").scrollIntoView({ behavior: "smooth", block: "start" });
    saveActive();
  }

  function removeBio(id, collectionId) {
    if (collectionId !== "recent") return;
    if (active?.id === id && activeCollection === collectionId) {
      clearTimeout(saveTimer);
      active = null;
    }
    enqueue(async () => {
      const collection = collections.get(collectionId);
      const removed = collection.items.filter(item => item.id === id);
      if (!removed.length) return;
      const result = await collection.store.remove(id);
      collection.removed = removed;
      return result;
    }, "Bio removed. Use Undo removal to restore it.", collectionId);
  }

  clearRecent.addEventListener("click", () => {
    // Guard the action too: a synthetic/stale click must never clear a department.
    if (selectedCollection !== "recent" || !collections.get("recent").items.length || clearPending) return;
    clearPending = true;
    if (activeCollection === "recent") { clearTimeout(saveTimer); active = null; }
    updateControls();
    enqueue(async () => {
      const collection = collections.get("recent");
      const removed = collection.items.slice();
      const result = await history.clear();
      collection.removed = removed;
      return result;
    }, "Recent bios cleared. Use Undo removal to restore them.").finally(() => {
      clearPending = false;
      updateControls();
    });
  });
  undo.addEventListener("click", () => {
    if (selectedCollection !== "recent") return;
    const collectionId = selectedCollection;
    enqueue(async () => {
      const collection = collections.get(collectionId);
      if (!collection.removed.length) return;
      const result = await collection.store.restore(collection.removed);
      collection.removed = [];
      return result;
    }, "Bios restored.", collectionId);
  });

  // Flush the old preview before a new parse or a clear replaces it.
  parseBtn.addEventListener("click", () => {
    if (rawInput.value.trim()) { saveActive(); active = null; }
  }, true);
  parseBtn.addEventListener("click", () => {
    const source = rawInput.value.trim();
    const name = document.getElementById("nameField").textContent.trim();
    if (!source || /^Physician Name(?:, Credentials)?$/.test(name)) return;
    const identity = normalizeSpaces(name).toLowerCase();
    if (displayedIdentity && displayedIdentity !== identity && photoSource && clean(photoSource) !== clean(source)) {
      showPhotoPlaceholder();
      cachedPhotoSource = cachedPhoto = photoSource = "";
    }
    displayedIdentity = identity;
    activeCollection = "recent";
    const existing = collections.get("recent").items.find(item => item.identity === identity || clean(item.source) === clean(source));
    active = {
      id: existing?.id || (window.crypto?.randomUUID?.() || "bio-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
      identity, source, createdAt: existing?.createdAt || Date.now()
    };
    updateControls();
    saveActive();
  });
  document.getElementById("clearBtn").addEventListener("click", () => {
    saveActive(); active = null; displayedIdentity = ""; photoSource = "";
    updateControls();
  }, true);
  pageInner.addEventListener("input", scheduleSave);
  pageInner.addEventListener("focusout", event => {
    // Keyboard navigation and accessibility clicks may focus before pointerdown.
    if (list.contains(event.relatedTarget) && !pressedAction) pressedAction = { pointerId: null };
    saveActive();
  });
  pageInner.addEventListener("change", scheduleSave);
  fontSizeSlider.addEventListener("input", scheduleSave);
  // Ignore the temporary synthetic editing toggles used by PDF/Print.
  editToggle.addEventListener("change", event => { if (event.isTrusted) scheduleSave(); });
  document.addEventListener("bio-photo-change", () => {
    if (!restoring) photoSource = rawInput.value.trim();
    scheduleSave();
  });
  photoImg.addEventListener("load", scheduleSave);
  downloadBtn.addEventListener("click", saveActive, true);
  printBtn.addEventListener("click", saveActive, true);
  window.addEventListener("pagehide", saveActive);
  window.addEventListener("resize", updateRecentListHeight);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveActive(); });
  collections.forEach((collection, id) => enqueue(() => collection.store.list(), "", id));
})();
