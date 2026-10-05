/* Save completed previews, not the unparsed contents of the input box. */
(function () {
  "use strict";
  const history = RecentBios.createStore(window);
  const list = document.getElementById("recentBiosList");
  const empty = document.getElementById("recentBiosEmpty");
  const status = document.getElementById("recentBiosStatus");
  const clearRecent = document.getElementById("clearRecentBtn");
  const undo = document.getElementById("undoRecentBtn");
  let items = [];
  let active = null;
  let removed = [];
  let saveTimer;
  let queue = Promise.resolve();
  let restoring = false;
  let cachedPhotoSource = "";
  let cachedPhoto = "";
  let photoSource = "";
  let displayedIdentity = "";

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

  function render() {
    const focused = document.activeElement;
    const focusId = focused?.dataset.bioId;
    const focusAction = focused?.dataset.action;
    list.replaceChildren();
    items.forEach(item => {
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
      ["Open", "Delete"].forEach(action => {
        const button = document.createElement("button");
        button.textContent = action;
        button.dataset.bioId = item.id;
        button.dataset.action = action;
        button.setAttribute("aria-label", action + " " + item.name);
        if (action === "Delete") button.className = "ghost";
        button.addEventListener("click", () => action === "Open" ? openBio(item.id) : removeBio(item.id));
        actions.appendChild(button);
      });
      row.append(details, actions);
      list.appendChild(row);
    });
    empty.hidden = items.length > 0;
    clearRecent.disabled = items.length === 0;
    undo.hidden = removed.length === 0;
    if (focusId) {
      const buttons = Array.from(list.querySelectorAll("button"));
      (buttons.find(button => button.dataset.bioId === focusId && button.dataset.action === focusAction) ||
        buttons[0] || undo).focus();
    }
  }

  function enqueue(operation, message) {
    queue = queue.then(async () => {
      const result = await operation();
      items = result.items;
      status.textContent = result.warning || message || "";
      render();
    }).catch(() => {
      status.textContent = "Recent bios could not be saved on this browser. Storage may be full or unavailable. Your current preview and PDF still work.";
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
      return items.find(item => item.id === active.id)?.photoSrc || "";
    }
    const source = photoImg.style.display === "none" ? "" : (photoImg.getAttribute("src") || "");
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

  function saveActive() {
    clearTimeout(saveTimer);
    if (restoring) return queue;
    let snapshot;
    try { snapshot = capture(); }
    catch (_) { status.textContent = "This bio could not be saved. Your current preview and PDF still work."; return queue; }
    if (!snapshot) return queue;
    return enqueue(() => history.save(snapshot));
  }

  function scheduleSave() {
    if (!active || restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveActive, 450);
  }

  async function openBio(id) {
    await saveActive();
    const item = items.find(item => item.id === id);
    if (!item) return;
    restoring = true;
    active = { id: item.id, identity: item.identity, source: item.source, createdAt: item.createdAt };
    displayedIdentity = item.identity;
    rawInput.value = item.source;
    // The edited preview is authoritative; parsing the old source would discard edits.
    RecentBios.FIELD_IDS.forEach(fieldId => { document.getElementById(fieldId).innerHTML = safeHtml(item.fields[fieldId]); });
    document.getElementById("credentialsField").style.display = "none";
    document.querySelectorAll(".field").forEach(field => {
      const section = item.sections[field.dataset.field];
      field.classList.toggle("hidden", section.hidden);
      field.querySelector(".section-toggle").checked = section.checked;
    });
    photoFileInput.value = "";
    photoSource = item.source;
    if (item.photoSrc) setPhotoSrc(item.photoSrc);
    else {
      [photoImg, photoPreviewImg].forEach(img => { img.removeAttribute("src"); img.style.display = "none"; });
      photoPlaceholder.style.display = "grid";
      photoPreviewText.style.display = "block";
    }
    fontSizeSlider.value = item.fontSize;
    fontSizeSlider.dispatchEvent(new Event("input"));
    editToggle.checked = item.editable;
    editToggle.dispatchEvent(new Event("change"));
    restoring = false;
    ensureBackgroundClears();
    status.textContent = "Opened " + item.name + ".";
    document.getElementById("nameField").setAttribute("tabindex", "-1");
    document.getElementById("nameField").focus({ preventScroll: true });
    document.querySelector(".preview-controls").scrollIntoView({ behavior: "smooth", block: "start" });
    saveActive();
  }

  function removeBio(id) {
    clearTimeout(saveTimer);
    if (active?.id === id) active = null;
    enqueue(async () => {
      removed = items.filter(item => item.id === id);
      return history.remove(id);
    }, "Bio removed. Use Undo removal to restore it.");
  }

  clearRecent.addEventListener("click", () => {
    clearTimeout(saveTimer);
    active = null;
    enqueue(async () => {
      removed = items.slice();
      return history.clear();
    }, "Recent bios cleared. Use Undo removal to restore them.");
  });
  undo.addEventListener("click", () => {
    enqueue(async () => {
      const result = await history.restore(removed);
      removed = [];
      return result;
    }, "Recent bios restored.");
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
      [photoImg, photoPreviewImg].forEach(img => { img.removeAttribute("src"); img.style.display = "none"; });
      photoPlaceholder.style.display = "grid";
      photoPreviewText.style.display = "block";
      photoFileInput.value = "";
      cachedPhotoSource = cachedPhoto = photoSource = "";
    }
    displayedIdentity = identity;
    const existing = items.find(item => item.identity === identity || clean(item.source) === clean(source));
    active = {
      id: existing?.id || (window.crypto?.randomUUID?.() || "bio-" + Date.now() + "-" + Math.random().toString(36).slice(2)),
      identity, source, createdAt: existing?.createdAt || Date.now()
    };
    saveActive();
  });
  document.getElementById("clearBtn").addEventListener("click", () => {
    saveActive(); active = null; displayedIdentity = ""; photoSource = "";
  }, true);
  pageInner.addEventListener("input", scheduleSave);
  pageInner.addEventListener("focusout", saveActive);
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
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveActive(); });
  enqueue(() => history.list());
})();
