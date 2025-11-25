/* ============================================================
   Basic text utilities
   ============================================================ */

// Normalize raw text (strip \r, tabs, trim)
function clean(text) {
  return (text || "").replace(/\r/g, "").replace(/\t/g, " ").trim();
}

// Split pasted content into usable lines, with some heuristics
function lines(text) {
  // Normalize weird linebreaks
  let t = clean(text).replace(/\u2028|\u2029/g, "\n"); // rare line-separator chars

  // If there are no newlines at all, heuristically inject some
  if (!t.includes("\n")) {
    t = t.replace(
      /(Johns Hopkins Medicine|Back to search|Share:|Print|Locations|Languages|Gender|Education|Background|Board Certifications?|Memberships?|Professional Titles?|Primary Academic Title)/g,
      "\n$1"
    );
  }

  // Split + basic filtering (no truncation)
  return t
    .split("\n")
    .map((s) => s.trim())
    .filter(
      (s) =>
        s &&
        !/^show more$/i.test(s) &&
        !/^show less$/i.test(s)
    );
}

// Simple debounce helper for layout recalculations
function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

function normalizeSpaces(s) {
  return s.replace(/\s+/g, " ").trim();
}

function titleCase(s) {
  return s.replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Insert bullets into specialties where formatting was stripped
function fixSpecialtyFormatting(s) {
  if (!s) return "";
  let out = s.trim();

  // If there are already obvious bullet-like separators, leave it alone
  if (/[•·]/.test(out)) return out;

  // Insert a separator when a lowercase or ")" is directly followed by Uppercase
  out = out.replace(/([a-z\)])([A-Z])/g, "$1 • $2");

  // Normalize spaces
  return out.replace(/\s+/g, " ");
}

/* ============================================================
   Parsing helpers (languages, headings, lists, education)
   ============================================================ */

// Parse languages from concatenated string like "BengaliEnglish"
function parseLanguages(s) {
  s = normalizeSpaces(s).replace(/•/g, " ").trim();
  s = s.replace(/([a-z])([A-Z])/g, "$1,$2");
  const parts = s
    .split(/[,/;| ]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const uniq = Array.from(new Set(parts.map((p) => titleCase(p))));
  return uniq.join(", ");
}

// Global list of headings that indicate the start of a new section.
// All comparisons are done case-insensitively on line.startsWith(heading).
const GLOBAL_STOP_HEADINGS = [
  // Core bio structure
  "languages",
  "language",
  "gender",
  "professional titles",
  "primary academic title",
  "about",
  "background",
  "education",
  "board certifications",
  "board certification",
  "memberships",
  "membership",
  "videos",
  "selected publications",
  "locations",
  "experience",
  "expertise",
  "conditions treated",
  "treatments & procedures",
  "treatments and procedures",
  "procedures",
  "in-network plans",
  "age groups seen",
  "insurance",
  "ratings & reviews",
  "ratings",
  "reviews",
  "graduate program affiliations",
  "linkedin",
  "professional activities",

  // Research / trials
  "clinical trial keywords",
  "clinical trials summary",
  "research interests",
  "lab website",
  "contact for research inquiries",
  "find a clinical trial",

  // Misc JH sections we never want inside blocks
  "centers and institutes",
  "recent news articles and media coverage",
  "additional academic titles",
  "lab website",
  "x (twitter)",
  "twitter",

  // Footer / chrome
  "schedule appointment",
  "schedule an appointment",
  "language assistance available",
  "contact & privacy information",
  "price transparency",
  "terms & conditions of use",
  "non-discrimination notice",
  "follow on facebook",
  "follow on twitter",
  "follow on linkedin",
  "follow on instagram",
  "follow on youtube",
  "follow on weibo"
].map((h) => h.toLowerCase());

function extractHeadingBlock(rawLines, startIdx, extraStopHeadings) {
  const extra = (extraStopHeadings || []).map((h) => h.toLowerCase());
  const stops = GLOBAL_STOP_HEADINGS.concat(extra);

  const out = [];
  for (let i = startIdx + 1; i < rawLines.length; i++) {
    const ln = rawLines[i] || "";
    const lower = ln.toLowerCase();
    if (stops.some((h) => lower.startsWith(h))) break;
    out.push(ln);
  }
  return out;
}

function findHeading(rawLines, headingVariants) {
  const keys = headingVariants.map((h) => h.toLowerCase());
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i].toLowerCase();
    if (keys.some((h) => ln.startsWith(h))) {
      return i;
    }
  }
  return -1;
}

function joinBlock(block) {
  return block.map(normalizeSpaces).join(" ");
}

function parseEducation(block) {
  const items = [];
  for (let i = 0; i < block.length; i += 2) {
    let line1 = normalizeSpaces(block[i] || "");
    let line2 = normalizeSpaces(block[i + 1] || "");

    // skip if both are empty
    if (!line1 && !line2) continue;

    if (line1 && line2) {
      items.push(`${line1} — ${line2}`);
    } else {
      // odd leftover line, just include whatever exists
      items.push(line1 || line2);
    }
  }
  return items;
}

function parseList(block) {
  const items = block
    .map((s) => normalizeSpaces(s).replace(/^•\s*/, "").trim())
    .filter(Boolean);
  return items;
}

/* ============================================================
   Name / specialty detection
   ============================================================ */

function isLikelyName(line) {
  const s = (line || "").trim();
  if (!s) return false;

  // Never treat the site name or obvious UI chrome as the physician name
  if (/johns hopkins medicine/i.test(s)) return false;
  if (/loading complete/i.test(s)) return false;

  // Explicitly exclude common header phrases we never want as names
  if (/accepting new patients/i.test(s)) return false;
  if (/out of 5 stars/i.test(s)) return false;
  if (/ratings?/i.test(s)) return false;

  const parts = s.split(/\s+/);
  if (parts.length < 2 || parts.length > 6) return false;

  function okWord(p) {
    // Normal case: capitalized word
    if (/^[A-Z][a-zA-Z.'-]+$/.test(p)) return true;

    // Allow short lowercase prefix + capital (e.g., "deBettencourt", "vanHouten")
    if (/^[a-z]{1,3}[A-Z][a-zA-Z.'-]+$/.test(p)) return true;

    return false;
  }

  return parts.every(okWord);
}


function isNoiseForSpecialty(line) {
  const s = (line || "").trim();
  if (!s) return true;
  if (/Accepting New Patients/i.test(s)) return true;
  if (/Online Booking/i.test(s)) return true;
  if (/out of 5 stars?/i.test(s)) return true; // rating line
  if (/ratings|reviews/i.test(s)) return true;
  if (/Highlights|Age Groups Seen|Languages|In-Network Plans/i.test(s)) return true;
  return false;
}


// Try to reconstruct name / credentials / specialty from the pasted text
function findNameAndSpecialty(rawLines) {
  let name = "";
  let creds = "";
  let specialty = "";

  const credTokens = [
    // Core physician degrees
    "MD",
    "DO",
    "MBBS",
    "MBBCh",
    "MBBChBAO",
    "BMBCh",
    "BM BCh",
    "MBChB",

    // Dentistry
    "DDS",
    "DMD",

    // Pharmacy
    "PharmD",

    // Doctoral / research / public health
    "PhD",
    "ScD",
    "DrPH",
    "DPH",

    // Veterinary
    "DVM",
    "VMD",
    "VetMB",

    // Law / business / admin
    "JD",
    "MBA",
    "MPA",
    "MSHA",

    // Master’s / science / health science
    "MA",
    "MS",
    "MSc",
    "MSE",
    "MAS",
    "MEd",
    "MHS",
    "MPhil",
    "M Math",
    "SM",
    "ScM",
    "AM",
    "Laurea",
    "Master of Biotechnology",
    "MSCE",
    "MSCI",

    // Public health & related
    "MPH",
    "MSPH",
    "MHSc",

    // Nursing / advanced practice
    "DNP",
    "CNM",
    "CRNP",
    "NP",
    "CNP",
    "FNP",
    "APRN",

    // Rehab / therapy
    "DPT",
    "MPT",
    "OTD",
    "OT",
    "SLP",

    // Vision / podiatry
    "OD",
    "DPM",

    // Genetics / counseling / social work
    "MGC",
    "MSW",

    // Informatics / bioethics
    "MBE",
    "MBI",

    // Dietetics / nutrition
    "RD",

    // Other medical / allied
    "ScM",

    // Existing subspecialty/board-style ones
    "FACC",
    "FSCAI",

    // Already-supported degrees that should remain
    "AuD"
  ];

  // 1) Try the structured header pattern around "Print"
  const idxPrint = rawLines.findIndex((l) => /^Print$/i.test((l || "").trim()));
  const startIdx = idxPrint >= 0 ? idxPrint + 1 : 0;
  const endIdx = Math.min(startIdx + 12, rawLines.length);

  for (let i = startIdx; i < endIdx; i++) {
    const line = rawLines[i];
    if (!isLikelyName(line)) continue;

    // Likely plain name line (e.g., "Erin Brown")
    name = line.trim();

    // Look for "Name, Credentials" on the next line
    if (i + 1 < rawLines.length) {
      const next = (rawLines[i + 1] || "").trim();
      const m = next.match(/^(.+?),\s*(.+)$/);
      if (m) {
        const firstWord = name.split(/\s+/)[0].toLowerCase();
        const firstWordNext = m[1].split(/\s+/)[0].toLowerCase();
        if (firstWord === firstWordNext) {
          creds = m[2].trim();
        }
      }
    }

    // Find specialty: first short, non-noise line after the name/cred block
    for (let j = i + 1; j < i + 8 && j < rawLines.length; j++) {
      const cand = (rawLines[j] || "").trim();
      if (!cand || isNoiseForSpecialty(cand)) continue;
      if (/johns hopkins/i.test(cand)) continue;

      // Don't treat "Name, Credentials" as a specialty
      if (name && cand.toLowerCase().includes(name.toLowerCase())) continue;

      if (cand.includes(":")) continue;
      if (cand.length > 200) continue; // allow long multi-phrase specialties
      specialty = cand;
      break;
    }

    break; // done with structured header parse
  }

  // 2) Fallback logic using lines (only scan header area, and avoid addresses)
  if (!name || !specialty) {
    const headerLimit = Math.min(rawLines.length, 80); // look only near the top
    for (let i = 0; i < headerLimit; i++) {
      const ln = (rawLines[i] || "").trim();
      if (!ln) continue;
      if (/back to search|new search|search]/i.test(ln)) continue;
      if (/johns hopkins medicine/i.test(ln)) continue;

      // Match "First Last Jr., MD" style lines; avoid addresses
      const m = ln.match(
        /^([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+)*(?:\s+(Jr\.?|Sr\.?|II|III|IV|V))?),\s*(.+)$/
      );
      if (!m) continue;

      const candidateName = m[1].trim();
      const candidateCreds = m[3].trim();

      // Only accept if the "after comma" part really looks like credentials
      if (!credTokens.some((t) => new RegExp("\\b" + t + "\\b").test(candidateCreds))) {
        continue;
      }

      name = candidateName;
      creds = candidateCreds;

      // Specialty in nearby lines
      for (let j = i + 1; j < i + 8 && j < rawLines.length; j++) {
        const nxt = (rawLines[j] || "").trim();
        if (!nxt) continue;
        if (isNoiseForSpecialty(nxt)) continue;
        if (/johns hopkins/i.test(nxt)) continue;

        // Skip lines that clearly repeat the name
        if (name && nxt.toLowerCase().includes(name.toLowerCase())) continue;

        if (nxt.includes(":")) break;
        if (nxt.length > 200) continue;
        specialty = nxt;
        break;
      }

      break;
    }
  }

  // 3) Extra regex fallback on the whole text
  if (!name) {
    const whole = rawLines.join(" ");
    const nameMatch = whole.match(
      /([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3}),\s*(MD|DO|PhD|MBBS|BMBCh|BM BCh|FACC|FSCAI|MBA|MPH|MS|CRNP|NP|CNP|FNP|DNP|PA-C|AuD)/
    );
    if (nameMatch) {
      name = nameMatch[1].trim();
      creds = nameMatch[2].trim();
    }
  }

  // 4) Last-resort: first "nice" name line that is not JH branding
  if (!name) {
    for (let i = 0; i < rawLines.length; i++) {
      if (isLikelyName(rawLines[i])) {
        name = rawLines[i].trim();
        break;
      }
    }
  }

  // Repair stripped formatting like "Spine SurgeryNeurosurgeryNeurosurgical Oncology"
  specialty = fixSpecialtyFormatting(specialty);

  return { name, creds, specialty };
}

/* ============================================================
   Location parsing
   ============================================================ */

function parseLocations(rawLines) {
  // Use the *last* occurrence of a standalone "Locations" heading,
  // since there's also a navigation tab named Locations near the top.
  let idxLocations = -1;
  for (let i = 0; i < rawLines.length; i++) {
    const v = (rawLines[i] || "").trim();
    if (/^Locations$/i.test(v)) idxLocations = i;
  }
  if (idxLocations < 0) return [];

  const block = [];
  for (let i = idxLocations + 1; i < rawLines.length; i++) {
    const s = (rawLines[i] || "").trim();
    if (!s) continue;

    // Skip junk lines we never want to treat as locations
    if (/^show more$/i.test(s) || /^show less$/i.test(s)) continue;
    if (/maplibre|openstreetmap/i.test(s)) continue;
    if (/^get directions$/i.test(s)) continue;
    if (/^loading booking information complete/i.test(s)) continue;
    if (/^schedule appointment/i.test(s)) continue;
    if (/^schedule an appointment/i.test(s)) continue;

    // Stop when we hit the next big section
    if (
      /^(experience|expertise|education|insurance|reviews?|ratings|board certifications?)$/i.test(s) ||
      /^ratings & reviews/i.test(s)
    ) {
      break;
    }

    block.push(s);
  }

  const locations = [];
  let i = 0;

  while (i < block.length) {
    let name = block[i] || "";
    // Strip any leading numbering like "1 " or "2 "
    name = name.replace(/^\d+\s+/, "");

    let address = "";
    let phone = "";
    let fax = "";

    // Next non-phone line is usually the address
    if (
      i + 1 < block.length &&
      !/^phone\b/i.test(block[i + 1]) &&
      !/^fax\b/i.test(block[i + 1])
    ) {
      address = block[i + 1];
      i += 2;
    } else {
      i += 1;
    }

    // Consume phone/fax lines for this location
    while (
      i < block.length &&
      (/^phone\b/i.test(block[i]) || /^fax\b/i.test(block[i]))
    ) {
      const line = block[i];
      const mPhone = line.match(/phone:\s*([0-9().-\s]+)/i);
      if (mPhone) phone = mPhone[1].trim();

      const mFax = line.match(/fax:\s*([0-9().-\s]+)/i);
      if (mFax) fax = mFax[1].trim();

      i++;
    }

    // Skip completely empty entries
    if (!name && !address && !phone && !fax) continue;

    locations.push({
      name: normalizeSpaces(name),
      address: normalizeSpaces(address),
      phone,
      fax
    });
  }

  return locations;
}

/* ============================================================
   Top-level parse function
   ============================================================ */

function parseDoctorText(text) {
  const rawLines = lines(text);
  const { name, creds, specialty } = findNameAndSpecialty(rawLines);

  // Affiliations
  let affiliations = "";
  for (let i = 0; i < rawLines.length; i++) {
    const ln = rawLines[i];
    const m = ln.match(/Johns Hopkins Affiliations:?(.+)?/i);
    if (m) {
      affiliations = m[1] ? normalizeSpaces(m[1]) : "";
      if (!affiliations && i + 1 < rawLines.length) {
        affiliations = normalizeSpaces(rawLines[i + 1] || "");
      }
      break;
    }
  }
  
  // Languages
  let languages = "";
  let idxLang = findHeading(rawLines, ["Languages", "Language"]);
  if (idxLang >= 0) {
    const block = extractHeadingBlock(rawLines, idxLang);
    const langLine =
      joinBlock(block).trim() || (rawLines[idxLang].split(":")[1] || "");
    languages = parseLanguages(langLine);
  }
  
  // Gender
  let gender = "";
  let idxGender = findHeading(rawLines, ["Gender"]);
  if (idxGender >= 0) {
    const block = extractHeadingBlock(rawLines, idxGender);
    gender = block[0]
      ? normalizeSpaces(block[0])
      : (rawLines[idxGender].split(":")[1] || "").trim();
  }
  
  // Titles
  let titles = [];
  let idxTitles = findHeading(rawLines, ["Professional Titles"]);
  if (idxTitles >= 0) {
    const block = extractHeadingBlock(rawLines, idxTitles);
    titles = parseList(block);
  }
  
  // Academic title
  let academicTitle = "";
  let idxAcademic = findHeading(rawLines, ["Primary Academic Title"]);
  if (idxAcademic >= 0) {
    const block = extractHeadingBlock(rawLines, idxAcademic);
    academicTitle = block[0]
      ? normalizeSpaces(block[0])
      : (rawLines[idxAcademic].split(":")[1] || "").trim();
  } else {
    const fallback = rawLines.find(
      (l) =>
        /Professor|Associate Professor|Assistant Professor/i.test(l) &&
        l.length < 160 &&
        !/johns hopkins medicine/i.test(l)
    );
    if (fallback) academicTitle = normalizeSpaces(fallback);
  }
  
  // Background / About
  let background = "";
  let idxBackground = findHeading(rawLines, ["Background"]);
  if (idxBackground >= 0) {
    const block = extractHeadingBlock(rawLines, idxBackground);
    background = joinBlock(block);
  } else {
    let idxAbout = findHeading(rawLines, ["About"]);
    if (idxAbout >= 0) {
      const block = extractHeadingBlock(rawLines, idxAbout);
      background = joinBlock(block);
    }
  }

  // Education
  let education = [];
  let idxEducation = findHeading(rawLines, ["Education"]);
  if (idxEducation >= 0) {
    const block = extractHeadingBlock(rawLines, idxEducation);
    education = parseEducation(block);
  }
  
  // Board certifications
  let certifications = [];
  let idxCerts = findHeading(rawLines, ["Board Certifications", "Board Certification"]);
  if (idxCerts >= 0) {
    const block = extractHeadingBlock(rawLines, idxCerts);
    certifications = parseEducation(block);
  }
  
  // Memberships
  let memberships = [];
  let idxMembers = findHeading(rawLines, ["Memberships", "Membership"]);
  if (idxMembers >= 0) {
    const block = extractHeadingBlock(rawLines, idxMembers);
    memberships = parseList(block);
  }
  
  const locations = parseLocations(rawLines);

  // Derive credentials from "Name, Credentials" if we haven't yet
  let credentials = creds;
  if (!credentials && name) {
    const near = rawLines.find((l) => l.includes(name) && l.includes(","));
    if (near) credentials = near.replace(name, "").replace(/^,\s*/, "").trim();
  }

  return {
    name: name || "Physician Name",
    credentials: credentials || "",
    specialty: specialty || "",
    affiliations: affiliations || "",
    languages: languages || "",
    gender: gender || "",
    titles,
    academicTitle,
    background,
    education,
    certifications,
    memberships,
    locations
  };
}

/* ============================================================
   Populate preview from parsed data
   ============================================================ */

function populatePreview(data) {
  const nameEl = document.getElementById("nameField");
  const credsEl = document.getElementById("credentialsField");
  const specEl = document.getElementById("specialtyField");

  const hasName = !!(data.name && data.name.trim());
  const hasCreds = !!(data.credentials && data.credentials.trim());

  const displayName = hasName
    ? hasCreds
      ? `${data.name.trim()}, ${data.credentials.trim()}`
      : data.name.trim()
    : "Physician Name";

  nameEl.textContent = displayName;

  // Credentials are merged into the name line, so hide the dedicated field
  if (credsEl) {
    credsEl.textContent = "";
    credsEl.style.display = "none";
  }

  const specialtyText =
    (data.specialty && data.specialty.trim()) || "Specialty";
  specEl.textContent = specialtyText;

  document.getElementById("affiliationsField").textContent =
    data.affiliations || "—";
  document.getElementById("languagesField").textContent =
    data.languages || "—";
  document.getElementById("genderField").textContent =
    data.gender || "—";
  document.getElementById("academicTitleField").textContent =
    data.academicTitle || "—";

  // Helper to populate <ul> lists with fallback "—"
  function populateList(listId, items) {
    const listEl = document.getElementById(listId);
    listEl.innerHTML = "";
    (items && items.length ? items : ["—"]).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      listEl.appendChild(li);
    });
  }

  populateList("titlesList", data.titles);
  populateList("educationList", data.education);
  populateList("certificationsList", data.certifications);
  populateList("membershipsList", data.memberships);

  // Locations (with numbering, bold headers, cleaned whitespace)
  const locationsField = document.getElementById("locationsField");
  locationsField.innerHTML = "";

  function cleanLine(str) {
    if (!str) return "";
    return escapeHtml(str.replace(/^\s+|\s+$/g, "")); // trims all whitespace including newlines
  }

  if (data.locations && data.locations.length) {
    const indent = `<span style="margin-left: 10px;"></span>`;
  
    const blocks = data.locations.map((loc, index) => {
      let lines = [];
  
      const locName = cleanLine(loc.name);
      const address = cleanLine(loc.address);
      const phone = cleanLine(loc.phone);
      const fax = cleanLine(loc.fax);
  
      const numberPrefix = (index + 1) + ". ";
      
      // First line: name only (no indent)
      let firstLine = `<strong>${numberPrefix}${locName || "Location"}</strong>`;
      lines.push(firstLine);
  
      // Address line WITH indent
      if (address) {
        lines.push(`${indent}${address}`);
      }
  
      // Phone / Fax with indent
      const phoneFax = [];
      if (phone) phoneFax.push("Phone: " + phone);
      if (fax) phoneFax.push("Fax: " + fax);
      if (phoneFax.length) {
        lines.push(`${indent}${phoneFax.join(" • ")}`);
      }
  
      return lines.join("<br>");
    });
  
    // Exactly one blank line between locations
    locationsField.innerHTML = blocks.join("<br><br>");
  
  } else {
    locationsField.textContent = "—";
  }

  const bgEl = document.getElementById("backgroundField");
  bgEl.textContent = data.background || "—";

  // ===== Auto-hide empty sections (except Background) =====
  (function autoHideEmptySections() {
    const autoHideKeys = new Set([
      "affiliations",
      "languages",
      "gender",
      "titles",
      "academic",
      "education",
      "certifications",
      "memberships",
      "locations"
    ]);
  
    const fields = document.querySelectorAll(".field");
  
    fields.forEach((field) => {
      const key = field.dataset.field;
      if (!key) return;
  
      // Never auto-hide Background
      if (key === "background") return;
  
      // Only auto-hide the specific sections listed above
      if (!autoHideKeys.has(key)) return;
  
      const valueEl = field.querySelector(".value, .list");
      if (!valueEl) return;
  
      let isEmpty = false;
  
      if (valueEl.tagName === "UL") {
        // Lists: empty if no <li> or only "—"
        const items = Array.from(valueEl.querySelectorAll("li"));
        if (
          items.length === 0 ||
          (items.length === 1 && items[0].textContent.trim() === "—")
        ) {
          isEmpty = true;
        }
      } else {
        // Normal value
        const text = valueEl.textContent.trim();
        if (!text || text === "—") {
          isEmpty = true;
        }
      }
  
      if (isEmpty) {
        field.classList.add("hidden");
      } else {
        field.classList.remove("hidden");
      }
    });
  })();

  
  // After updating content, make sure float + page breaks are correct
  ensureBackgroundClears();
}

/* ============================================================
   Page guide / layout helpers
   ============================================================ */

// Compute the approximate DOM pixel height that corresponds to
// one PDF page of content (between the top and bottom margins).
function getPageHeightPx(pageEl) {
  const el = pageEl || document.getElementById("pdfPage");
  if (!el) return 0;

  // Width of your on-screen "page" in CSS pixels
  const pageWidthPx = el.clientWidth || el.offsetWidth;
  if (!pageWidthPx) return 0;

  // jsPDF letter size in points (default in your export)
  const pageWidthPt = 612;   // 8.5in * 72
  const pageHeightPt = 792;  // 11in * 72

  // Same margins you use in the PDF export code
  const marginPt = 36;       // 0.5 inch
  const usableHeightPt = pageHeightPt - marginPt * 2;
  const imgWidthPt = pageWidthPt - marginPt * 2;

  // Map usable PDF height to DOM pixels
  // (html2canvas scale cancels out when you compare to element width)
  const pageHeightPx = (usableHeightPt * pageWidthPx) / imgWidthPt;
  return pageHeightPx;
}

function updatePageGuides() {
  const pageEl = document.getElementById("pdfPage");
  if (!pageEl) return;

  // Remove existing guides
  pageEl.querySelectorAll(".page-guide").forEach((el) => el.remove());

  const pageHeight = getPageHeightPx(pageEl);
  if (!pageHeight) return;

  const totalHeight = pageEl.scrollHeight;
  let page = 2;

  for (let offset = pageHeight; offset < totalHeight; offset += pageHeight) {
    const guide = document.createElement("div");
    guide.className = "page-guide";
    guide.style.top = offset + "px";

    const label = document.createElement("span");
    label.textContent = "Page " + page;
    guide.appendChild(label);

    pageEl.appendChild(guide);
    page++;
  }
}

// Try to avoid sections straddling a page boundary (except background)
function applySectionPageBreaks() {
  const pageEl = document.getElementById("pdfPage");
  if (!pageEl) return;

  const pageHeight = getPageHeightPx(pageEl);
  if (!pageHeight) return;

  const fields = Array.from(pageEl.querySelectorAll(".field"));

  // Reset any previous adjustments to get a clean layout
  fields.forEach((field) => {
    if (!field.dataset.baseMarginTop) {
      field.dataset.baseMarginTop =
        getComputedStyle(field).marginTop || "0px";
    }
    field.style.marginTop = field.dataset.baseMarginTop;
  });

  const pageRect = pageEl.getBoundingClientRect();
  const EXTRA = 60; // how far below the new page top we push the section
  const GUARD = 10; // how close to a page break we treat as "crossing"

  fields.forEach((field) => {
    // Background is allowed to spill across pages
    if (field.dataset.field === "background") return;
    if (field.classList.contains("hidden")) return;

    const rect = field.getBoundingClientRect();
    const top = rect.top - pageRect.top;      // px from top of layout
    const bottom = rect.bottom - pageRect.top;

    const startPage = Math.floor(top / pageHeight);
    const boundary = (startPage + 1) * pageHeight; // first boundary below this section

    // If the bottom is past the boundary - GUARD, treat it as crossing
    if (bottom > boundary - GUARD) {
      const shift = boundary - top + EXTRA;

      const current =
        parseFloat(field.style.marginTop || field.dataset.baseMarginTop || "0") || 0;
      field.style.marginTop = current + shift + "px";
    }
  });
}

// Ensure the "Background" section clears the photo float and adjust page breaks
function ensureBackgroundClears() {
  const photoBox = document.querySelector(".photo-box");
  const backgroundField = document.querySelector('[data-field="background"]');

  if (!photoBox || !backgroundField) {
    applySectionPageBreaks();
    updatePageGuides();
    return;
  }

  const allFields = Array.from(document.querySelectorAll(".field"));
  const backgroundIndex = allFields.indexOf(backgroundField);
  const fieldsBeforeBackground = allFields
    .slice(0, backgroundIndex)
    .filter((f) => !f.classList.contains("hidden"));

  let cumulativeHeight = 0;
  fieldsBeforeBackground.forEach((field) => {
    cumulativeHeight += field.offsetHeight;
  });

  if (cumulativeHeight < photoBox.offsetHeight) {
    backgroundField.classList.add("clear-float");
  } else {
    backgroundField.classList.remove("clear-float");
  }

  applySectionPageBreaks();
  updatePageGuides();
}

// Recalculate layout after inline edits (debounced)
const recalcLayoutAfterEdit = debounce(() => {
  ensureBackgroundClears();
}, 150);

function attachInlineEditListeners() {
  const selectors = [
    "#nameField",
    "#specialtyField",
    "#affiliationsField",
    "#locationsField",
    "#languagesField",
    "#genderField",
    "#academicTitleField",
    "#backgroundField",
    "#titlesList",
    "#educationList",
    "#certificationsList",
    "#membershipsList"
  ];

  selectors.forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener("input", recalcLayoutAfterEdit);
  });
}

/* ============================================================
   Photo handling (upload + paste)
   ============================================================ */

const photoFileInput = document.getElementById("photoFile");
const photoImg = document.getElementById("photoImg");
const photoPlaceholder = document.getElementById("photoPlaceholder");
const photoPreview = document.getElementById("photoPreview");
const photoPreviewImg = document.getElementById("photoPreviewImg");
const photoPreviewText = document.getElementById("photoPreviewText");

// Show image in both preview and floated photo box
function setPhotoSrc(src) {
  photoImg.src = src;
  photoImg.style.display = "block";
  photoPlaceholder.style.display = "none";

  photoPreviewImg.src = src;
  photoPreviewImg.style.display = "block";
  photoPreviewText.style.display = "none";
}

photoFileInput.addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (evt) {
    const src = evt.target.result;
    setPhotoSrc(src);
  };
  reader.readAsDataURL(file);
});

photoPreview.addEventListener("paste", (event) => {
  if (!event.clipboardData) return;

  const items = event.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      const reader = new FileReader();

      reader.onload = function (evt) {
        const src = evt.target.result;
        setPhotoSrc(src);
      };

      reader.readAsDataURL(file);
      event.preventDefault();
      break;
    }
  }
});

/* ============================================================
   Inline editing & font size controls
   ============================================================ */

const fontSizeSlider = document.getElementById("fontSizeSlider");
const fontSizeValue = document.getElementById("fontSizeValue");
const pageInner = document.getElementById("pageInner");
const editToggle = document.getElementById("editToggle");

fontSizeSlider.addEventListener("input", (e) => {
  const size = parseFloat(e.target.value);
  fontSizeValue.textContent = size + "px";

  pageInner.style.setProperty("--content-font-size", size + "px");

  document.querySelectorAll(".value, .list").forEach((el) => {
    el.style.fontSize = size + "px";
  });

  document.querySelectorAll(".label").forEach((el) => {
    el.style.fontSize = size + 1 + "px";
  });

  // NEW — recalc after fonts fully reflow
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      ensureBackgroundClears();
    });
  });
});

editToggle.addEventListener("change", (e) => {
  const editable = e.target.checked;
  pageInner.classList.toggle("editable", editable);
  const ids = [
    "affiliationsField",
    "locationsField",
    "languagesField",
    "genderField",
    "academicTitleField",
    "backgroundField",
    "nameField",
    "credentialsField",
    "specialtyField"
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    el.contentEditable = editable ? "true" : "false";
  });
  document.getElementById("titlesList").contentEditable = editable ? "true" : "false";
  document.getElementById("educationList").contentEditable = editable ? "true" : "false";
  document.getElementById("certificationsList").contentEditable = editable ? "true" : "false";
  document.getElementById("membershipsList").contentEditable = editable ? "true" : "false";
});

// Show/hide entire sections with little checkboxes
document.querySelectorAll(".section-toggle").forEach((checkbox) => {
  checkbox.addEventListener("change", (e) => {
    const field = e.target.closest(".field");
    if (!e.target.checked) {
      field.classList.add("hidden");
    } else {
      field.classList.remove("hidden");
    }
    setTimeout(ensureBackgroundClears, 10);
  });
});

/* ============================================================
   Parse / Clear buttons
   ============================================================ */

const parseBtn = document.getElementById("parseBtn");
const rawInput = document.getElementById("rawInput");

parseBtn.addEventListener("click", () => {
  const t = rawInput.value || "";
  if (!t.trim()) {
    alert("Please paste the physician's page text first.");
    return;
  }
  const data = parseDoctorText(t);
  populatePreview(data);

  // Scroll to preview controls after parsing
  document.querySelector(".preview-controls")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });

  // Turn on inline editing after a successful parse
  editToggle.checked = true;
  editToggle.dispatchEvent(new Event("change"));
  setTimeout(ensureBackgroundClears, 100);
});

document.getElementById("clearBtn").addEventListener("click", () => {
  rawInput.value = "";
  populatePreview({
    name: "Physician Name",
    credentials: "Credentials",
    specialty: "Specialty",
    affiliations: "—",
    languages: "—",
    gender: "—",
    titles: [],
    academicTitle: "—",
    background: "—",
    education: [],
    certifications: [],
    memberships: [],
    locations: []
  });

  // Reset photos
  photoImg.src = "";
  photoImg.style.display = "none";
  photoPlaceholder.style.display = "grid";
  photoPreviewImg.src = "";
  photoPreviewImg.style.display = "none";
  photoPreviewText.style.display = "block";

   // Scroll back to the top
   window.scrollTo({
     top: 0,
     behavior: "smooth"
   });

  // Disable inline editing
  editToggle.checked = false;
  editToggle.dispatchEvent(new Event("change"));

  // Reset font weights / sizes
  fontSizeSlider.value = 14;
  fontSizeValue.textContent = "14px";
  document.querySelectorAll(".value, .list").forEach((el) => {
    el.style.fontSize = "14px";
  });
  document.querySelectorAll(".label").forEach((el) => {
    el.style.fontSize = "15px";
  });

  setTimeout(ensureBackgroundClears, 50);
});

/* ============================================================
   PDF download & print
   ============================================================ */

const downloadBtn = document.getElementById("downloadBtn");
const printBtn = document.getElementById("printBtn");

downloadBtn.addEventListener("click", async () => {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert("PDF library failed to load. Please try reloading the page.");
    return;
  }
  const pageEl = document.getElementById("pdfPage");
  const wasEditable = editToggle.checked;

  // Turn off inline editing while capturing so outlines don't appear
  if (wasEditable) {
    editToggle.checked = false;
    editToggle.dispatchEvent(new Event("change"));
  }

  // Hide guides & border while capturing
  pageEl.classList.add("printing");

  const canvas = await html2canvas(pageEl, {
    backgroundColor: "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false
  });

  // Restore normal appearance
  pageEl.classList.remove("printing");

  if (wasEditable) {
    editToggle.checked = true;
    editToggle.dispatchEvent(new Event("change"));
  }

  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 36;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const imgWidth = pageWidth - margin * 2;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  const usablePageHeight = pageHeight - margin * 2;
  const totalPages = Math.ceil(imgHeight / usablePageHeight);

  const pageCanvas = document.createElement("canvas");
  const pageCtx = pageCanvas.getContext("2d");

  const pxPageHeight = Math.floor((usablePageHeight * canvas.width) / imgWidth);
  pageCanvas.width = canvas.width;

  for (let page = 0; page < totalPages; page++) {
    const sY = page * pxPageHeight;
    const sHeight = Math.min(pxPageHeight, canvas.height - sY);
    pageCanvas.height = sHeight;

    pageCtx.clearRect(0, 0, pageCanvas.width, pageCanvas.height);
    pageCtx.drawImage(
      canvas,
      0,
      sY,
      canvas.width,
      sHeight,
      0,
      0,
      pageCanvas.width,
      sHeight
    );

    const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
    if (page > 0) {
      doc.addPage();
    }
    const renderHeight = (sHeight * imgWidth) / canvas.width;
    doc.addImage(imgData, "JPEG", margin, margin, imgWidth, renderHeight);
  }

  const nameText =
    (document.getElementById("nameField").textContent || "Physician").replace(
      /\s+/g,
      "_"
    );
  doc.save(`${nameText}_Bio.pdf`);
});

printBtn.addEventListener("click", () => {
  const pageEl = document.getElementById("pdfPage");
  const wasEditable = editToggle.checked;

  // Turn off inline editing while printing so you don't see outlines
  if (wasEditable) {
    editToggle.checked = false;
    editToggle.dispatchEvent(new Event("change"));
  }

  pageEl.classList.add("printing");
  window.print();
  pageEl.classList.remove("printing");

  if (wasEditable) {
    editToggle.checked = true;
    editToggle.dispatchEvent(new Event("change"));
  }
});

/* ============================================================
   Initial setup
   ============================================================ */

// Initial empty preview
populatePreview({
  name: "Physician Name",
  credentials: "Credentials",
  specialty: "Specialty",
  affiliations: "—",
  languages: "—",
  gender: "—",
  titles: [],
  academicTitle: "—",
  background: "—",
  education: [],
  certifications: [],
  memberships: [],
  locations: []
});

// Default font sizes
document.querySelectorAll(".value, .list").forEach((el) => {
  el.style.fontSize = "14px";
});
document.querySelectorAll(".label").forEach((el) => {
  el.style.fontSize = "15px";
});

window.addEventListener("load", () => {
  attachInlineEditListeners();
  setTimeout(ensureBackgroundClears, 50);
});

window.addEventListener("resize", debounce(() => {
  ensureBackgroundClears();
}, 150));
