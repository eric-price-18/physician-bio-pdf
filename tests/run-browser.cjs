// Uses an existing Playwright installation and Chrome; does not install packages.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || path.join(root, '..', 'browser-evidence'));
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, 'synthetic-profile-'));
async function main() {
  // Fulfill this synthetic origin from local files: no network/server required.
  const origin = 'http://physician-bio.test';
  let context;
  const report = [];
  try {
    context = await chromium.launchPersistentContext(profile, { ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: process.env.BROWSER_CHANNEL || 'chrome' }), headless: true, viewport: { width: 1280, height: 1000 } });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      const file = path.resolve(root, '.' + url.pathname);
      if (!file.startsWith(root + path.sep)) return route.fulfill({ status: 403 });
      try {
        // Synthetic suites intentionally test empty collections, independently of the published roster.
        const body = path.basename(file) === 'department-bios.js' ? Buffer.from('window.DepartmentBios = window.DepartmentBios || {};') : fs.readFileSync(file);
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
        await route.fulfill({ body, contentType: types[path.extname(file)] || 'application/octet-stream' });
      } catch (_) { await route.fulfill({ status: 404 }); }
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const suite of (process.env.ONLY_PRESETS ? [] : ['browser-history', 'browser-section-state', 'browser-departments'])) {
      await page.goto(origin + '/tests/' + suite + '.html');
      await page.locator('#run').click();
      await page.waitForFunction(() => /ALL .* CHECKS PASSED|FAIL:/.test(document.getElementById('result').textContent), null, { timeout: 60000 });
      const result = await page.locator('#result').innerText(); report.push(suite + '\n' + result); console.log(result);
      assert(!result.includes('FAIL:'), suite + ' failed');
    }
    const api = require('../recent-bios.js');
    const seedPhoto = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 2; canvas.getContext('2d').fillRect(0, 0, 2, 2); return canvas.toDataURL(); });
    const seeds = ['One', 'Two', 'Three'].map((name, index) => ({ version: 1, id: 'seed-' + name, identity: 'seed-' + name,
      name: 'Synthetic Seed ' + name, source: 'Synthetic source ' + name, createdAt: 1000, updatedAt: 1000,
      fields: Object.fromEntries(api.FIELD_IDS.map(key => [key, key === 'nameField' ? 'Synthetic Seed ' + name : key === 'credentialsField' ? '' : 'Synthetic ' + key])),
      sections: Object.fromEntries(api.SECTION_KEYS.map(key => { const hidden = (index === 0 && key === 'certifications') || (index < 2 && key === 'locations'); return [key, { hidden, checked: !hidden }]; })),
      photoSrc: seedPhoto, fontSize: 14, editable: true }));
    const presetPage = await context.newPage();
    presetPage.on('pageerror', error => errors.push(error.message));
    await presetPage.addInitScript(seeds => { window.DepartmentBios = { 'front-desk': seeds }; }, seeds);
    await presetPage.goto(origin + '/index.html');
    await presetPage.getByRole('tab', { name: 'Cath Lab', exact: true }).click();
    await presetPage.getByRole('button', { name: 'Open Synthetic Seed One', exact: true }).click();
    await presetPage.waitForFunction(() => document.getElementById('nameField').textContent === 'Synthetic Seed One');
    assert.equal(await presetPage.locator('[data-field="certifications"] .section-toggle').isChecked(), false);
    await presetPage.locator('#backgroundField').fill('Synthetic local catalog edit');
    await presetPage.getByRole('button', { name: 'Open Synthetic Seed One', exact: true }).click();
    assert.equal(await presetPage.locator('#backgroundField').innerHTML(), 'Synthetic backgroundField');
    assert.equal(await presetPage.locator('#saveDepartmentBtn').count(), 0);
    assert.equal(await presetPage.locator('[data-action="Delete"]').count(), 0);
    await presetPage.reload(); await presetPage.getByRole('tab', { name: 'Cath Lab', exact: true }).click();
    await presetPage.getByRole('button', { name: 'Open Synthetic Seed One', exact: true }).click();
    assert.equal(await presetPage.locator('#backgroundField').innerHTML(), 'Synthetic backgroundField');
    assert.equal(await presetPage.locator('#photoImg').getAttribute('src'), seedPhoto);
    await presetPage.getByRole('button', { name: 'Open Synthetic Seed Two', exact: true }).click();
    await presetPage.waitForFunction(() => document.getElementById('nameField').textContent === 'Synthetic Seed Two');
    assert(await presetPage.locator('[data-field="certifications"] .section-toggle').isChecked());
    assert.equal(await presetPage.locator('[data-field="locations"] .section-toggle').isChecked(), false);
    assert.equal(await presetPage.locator('[data-action="Open"]').count(), 3);
    await presetPage.close();
    report.push('PASS: bundled presets appear on a fresh origin; read-only controls; transient edits reset on reopen/reload; paired photo and categories intact');
    console.log(report.at(-1));
    await page.goto(origin + '/index.html');
    const recent = page.getByRole('tab', { name: 'Recent bios', exact: true });
    const department = page.getByRole('tab', { name: 'Cath Lab', exact: true });
    await department.waitFor();
    await recent.focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await department.getAttribute('aria-selected'), 'true');
    assert(await department.evaluate(el => el === document.activeElement));
    assert(await page.locator('#clearRecentBtn').isDisabled());
    await page.keyboard.press('ArrowRight'); assert.equal(await recent.getAttribute('aria-selected'), 'true');
    await page.keyboard.press('End'); assert.equal(await department.getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Home'); assert.equal(await recent.getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowLeft'); assert.equal(await department.getAttribute('aria-selected'), 'true');
    await page.keyboard.press('Tab'); assert(await page.locator('#bioCollectionPanel').evaluate(el => el === document.activeElement));
    await page.locator('.recent-bios').screenshot({ path: path.join(output, 'cath-lab-empty.png') });
    await page.locator('#rawInput').fill('Synthetic Demo, MD\nCardiology\nGender\nFemale\nBackground\nSynthetic test biography.');
    await page.locator('#parseBtn').click();
    assert.equal(await page.locator('#saveDepartmentBtn').count(), 0);
    await recent.click();
    await page.getByRole('button', { name: 'Open Synthetic Demo, MD', exact: true }).waitFor();
    await page.locator('.recent-bios').screenshot({ path: path.join(output, 'cath-lab-populated.png') });
    await recent.click(); assert(await page.locator('#clearRecentBtn').isEnabled());
    await page.locator('.recent-bios').screenshot({ path: path.join(output, 'recent-populated.png') });
    for (const width of [320, 360, 480, 1280]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.locator('.recent-bios-header').evaluate(el => {
        const tabs = el.querySelector('[role="tablist"]').getBoundingClientRect();
        const clear = el.querySelector('#clearRecentBtn').getBoundingClientRect();
        return { rightOfTabs: clear.left >= tabs.right, inViewport: clear.right <= innerWidth, sameRow: Math.abs(clear.top - tabs.top) < 10 };
      });
      assert(layout.rightOfTabs && layout.inViewport && layout.sameRow, 'Clear all stays to the right at ' + width + 'px');
      await department.click(); assert(await page.locator('#clearRecentBtn').isDisabled());
      assert.equal(await department.getAttribute('aria-selected'), 'true');
      if (width === 320) await page.locator('.recent-bios').screenshot({ path: path.join(output, 'cath-lab-320px.png') });
      await recent.click();
    }
    assert.deepEqual(errors, [], 'No browser JavaScript errors');
    report.push('PASS: real keyboard arrows, wraparound, Home/End, focus, panel Tab stop; Clear all placement and disabled state at 320/360/480/1280px; no browser JavaScript errors');
    console.log(report.at(-1));
  } finally {
    fs.writeFileSync(path.join(output, 'browser-results.txt'), report.join('\n\n'));
    await context?.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
