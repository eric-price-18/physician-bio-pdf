// Run with the existing Playwright installation and Chrome; no packages are installed.
// node tests/run-layout.cjs [evidence-directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '..', 'layout-evidence'));
fs.mkdirSync(output, { recursive: true });
const sectionKeys = ['background', 'education', 'certifications', 'memberships', 'locations'];

function geometry() {
  const box = el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  };
  return {
    photo: box(document.querySelector('.photo-box')),
    contentLeft: box(document.getElementById('fieldsColumn')).left,
    fields: [...document.querySelectorAll('.field')].filter(el => getComputedStyle(el).display !== 'none')
      .map(el => ({ key: el.dataset.field, ...box(el) })),
    name: document.getElementById('nameField').textContent
  };
}

function checkLayout(layout, label) {
  const photo = layout.photo;
  for (const field of layout.fields.filter(f => sectionKeys.includes(f.key))) {
    if (photo.height) assert(field.top >= photo.bottom - 0.5, `${label}: ${field.key} overlaps the photo vertically`);
    assert.equal(Math.round(field.left), Math.round(layout.contentLeft), `${label}: ${field.key} must use the full content column`);
  }
  if (photo.height) {
    const identity = layout.fields.find(f => f.key === 'affiliations');
    assert(identity.top < photo.bottom && identity.left >= photo.right, `${label}: top identity remains beside photo`);
  }
}

async function main() {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, acceptDownloads: true });
  const origin = 'http://physician-bio.test';
  const report = { cases: 0, checks: [], errors: [] };
  try {
    await context.route(origin + '/**', async route => {
      const url = new URL(route.request().url());
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
      if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403 });
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      try { await route.fulfill({ body: fs.readFileSync(path.basename(file) === 'styles.css' && process.env.BASELINE_CSS ? process.env.BASELINE_CSS : file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
      catch { await route.fulfill({ status: 404 }); }
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(origin + '/');
    await page.waitForFunction(() => window.jspdf?.jsPDF && window.html2canvas);
    await page.evaluate(() => document.fonts.ready);
    const seed = {
      name: 'Synthetic Layout', credentials: 'MD', specialty: 'General Surgery',
      affiliations: 'Johns Hopkins Medicine', languages: 'English', gender: 'Male',
      titles: ['Surgeon'], academicTitle: 'Associate Professor', background: 'Synthetic test biography.',
      education: ['Residency: Synthetic University, 2020'], certifications: ['Surgery, 2021'],
      memberships: ['Synthetic College of Surgeons'], locations: [{ name: 'Synthetic Clinic', address: '1 Test Road', phone: '555-0100' }]
    };
    const photo = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 180; c.height = 240;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#386998'; ctx.fillRect(0, 0, 180, 240);
      ctx.fillStyle = '#fff'; ctx.font = '16px Arial'; ctx.fillText('Synthetic photo', 28, 120);
      return c.toDataURL();
    });
    for (const media of ['screen', 'print', 'capture']) {
      await page.emulateMedia({ media: media === 'print' ? 'print' : 'screen' });
      for (const photoMode of ['photo', 'placeholder', 'none']) {
        for (const fontSize of [8, 14, 22]) {
          for (let mask = 0; mask < 32; mask++) {
            await page.evaluate(({ seed, photo, photoMode, fontSize, mask, media, sectionKeys }) => {
              populatePreview(seed);
              setPhotoSrc(photoMode === 'photo' ? photo : '');
              document.querySelector('.photo-box').style.display = photoMode === 'none' ? 'none' : '';
              document.getElementById('pdfPage').classList.toggle('printing', media === 'capture');
              document.querySelectorAll('.value, .list').forEach(el => el.style.fontSize = fontSize + 'px');
              document.querySelectorAll('.label').forEach(el => el.style.fontSize = fontSize + 1 + 'px');
              sectionKeys.forEach((key, index) => setSectionVisible(document.querySelector(`[data-field="${key}"]`), !!(mask & (1 << index))));
              ensureBackgroundClears();
            }, { seed, photo, photoMode, fontSize, mask, media, sectionKeys });
            checkLayout(await page.evaluate(geometry), `${media}/${photoMode}/${fontSize}/${mask}`);
            report.cases++;
          }
        }
      }
    }
    report.checks.push('All 32 lower-section visibility combinations, photo/placeholder/no box, font sizes 8/14/22, screen/print/PDF capture; identity fields stay beside photo.');
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(({ seed, photo }) => {
      document.querySelector('.photo-box').style.display = '';
      populatePreview(seed); setPhotoSrc(photo);
      document.querySelectorAll('.value, .list').forEach(el => el.style.fontSize = '14px');
      document.querySelectorAll('.label').forEach(el => el.style.fontSize = '15px');
      document.getElementById('pdfPage').classList.remove('printing');
      ensureBackgroundClears();
    }, { seed, photo });
    await page.locator('#pdfPage').screenshot({ path: path.join(output, 'bio-present.png') });
    await page.locator('#editToggle').check();
    await page.locator('[data-field="background"] .section-toggle').uncheck();
    // The CSS invariant must hold synchronously, before the delayed JS recalculation.
    checkLayout(await page.evaluate(geometry), 'actual Bio checkbox');
    await page.locator('#pdfPage').screenshot({ path: path.join(output, 'bio-absent.png') });
    await page.locator('[data-field="education"] .section-toggle').uncheck();
    checkLayout(await page.evaluate(geometry), 'actual Bio and Education checkboxes');
    await page.locator('#pdfPage').screenshot({ path: path.join(output, 'bio-education-absent.png') });
    await page.locator('[data-field="certifications"] .section-toggle').uncheck();
    await page.locator('[data-field="memberships"] .section-toggle').uncheck();
    checkLayout(await page.evaluate(geometry), 'Locations first');
    await page.locator('#pdfPage').screenshot({ path: path.join(output, 'locations-first.png') });
    await page.evaluate(seed => populatePreview({ ...seed, education: [] }), seed);
    assert(await page.locator('[data-field="education"]').evaluate(el => el.classList.contains('hidden')));
    await page.locator('[data-field="background"] .section-toggle').uncheck();
    checkLayout(await page.evaluate(geometry), 'Education absent from parsed data');
    report.checks.push('Real checkbox changes and parsed empty Education preserve the invariant immediately.');
    // Exercise the production html2canvas + jsPDF button, retaining its actual raster capture.
    await page.evaluate(geometrySource => {
      window.__layoutGeometry = (0, eval)('(' + geometrySource + ')');
      const capture = window.html2canvas;
      window.html2canvas = async (...args) => {
        window.__exportLayout = window.__layoutGeometry();
        const canvas = await capture(...args);
        window.__exportPng = canvas.toDataURL('image/png');
        return canvas;
      };
    }, geometry.toString());
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#downloadBtn').click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'download-bio.pdf'));
    checkLayout(await page.evaluate(() => window.__exportLayout), 'production PDF capture');
    const png = await page.evaluate(() => window.__exportPng);
    fs.writeFileSync(path.join(output, 'download-capture.png'), Buffer.from(png.split(',')[1], 'base64'));
    assert(await page.locator('#editToggle').isChecked(), 'editing restored after PDF capture');
    await page.evaluate(geometrySource => {
      window.print = () => {
        window.__printLayout = (0, eval)('(' + geometrySource + ')')();
        window.__printEditable = document.getElementById('editToggle').checked;
        window.__printCapture = document.getElementById('pdfPage').classList.contains('printing');
      };
    }, geometry.toString());
    await page.locator('#printBtn').click();
    checkLayout(await page.evaluate(() => window.__printLayout), 'Print button state');
    assert.deepEqual(await page.evaluate(() => [window.__printEditable, window.__printCapture]), [false, true]);
    assert(await page.locator('#editToggle').isChecked(), 'editing restored after print');
    await page.locator('#editToggle').uncheck();
    await page.emulateMedia({ media: 'print' });
    checkLayout(await page.evaluate(geometry), 'native print');
    await page.pdf({ path: path.join(output, 'print-bio.pdf'), format: 'Letter', printBackground: true });
    await page.locator('#pdfPage').screenshot({ path: path.join(output, 'print-layout.png') });
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(seed => populatePreview(seed), seed);
    const secondDownloadPromise = page.waitForEvent('download');
    await page.locator('#downloadBtn').click();
    await (await secondDownloadPromise).saveAs(path.join(output, 'download-bio-present.pdf'));
    checkLayout(await page.evaluate(() => window.__exportLayout), 'production PDF with Bio');
    await page.emulateMedia({ media: 'print' });
    checkLayout(await page.evaluate(geometry), 'native print with Bio');
    await page.pdf({ path: path.join(output, 'print-bio-present.pdf'), format: 'Letter', printBackground: true });
    report.checks.push('Production Download PDF (real html2canvas/jsPDF) and Chromium print-to-PDF completed.');
    assert.deepEqual(report.errors, []);
    console.log(`PASS: ${report.cases} layout cases plus real checkbox, auto-hide, PDF and print checks; no browser errors.`);
  } finally {
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
