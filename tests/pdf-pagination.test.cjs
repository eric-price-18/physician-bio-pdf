const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the production helper without requiring a browser or dependencies.
const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const start = source.indexOf('function getPdfPageCount(');
const end = source.indexOf('const downloadBtn =', start);
assert(start >= 0 && end > start);
const context = {};
vm.runInNewContext(source.slice(start, end), context);

function canvas(height, marks = [], width = 3) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [row, rgba = [0, 0, 0, 255], x = 0] of marks) {
    data.set(rgba, (row * width + x) * 4);
  }
  return { width, height, getContext: () => ({
    getImageData: (x, y, w, h) => {
      assert.equal(x, 0); assert.equal(w, width);
      assert(y >= 0 && h > 0 && y + h <= height);
      return { data: data.slice(y * width * 4, (y + h) * width * 4) };
    }
  }) };
}

const count = context.getPdfPageCount;
assert.equal(count(canvas(100, [[99]]), 100), 1, 'exactly one full page');
assert.equal(count(canvas(101, [[99]]), 100), 1, 'one blank overflow row');
assert.equal(count(canvas(300, [[99]]), 100), 1, 'multiple blank trailing pages');
assert.equal(count(canvas(101, [[100]]), 100), 2, 'first pixel of page two retained');
assert.equal(count(canvas(201, [[200]]), 100), 3, 'last pixel after rounded slices retained');
assert.equal(count(canvas(301, [[200]]), 100), 3, 'internal blank page preserved');
assert.equal(count(canvas(201, [[200, [254, 255, 255, 255], 2]]), 100), 3, 'faint right-edge pixel retained');
assert.equal(count(canvas(201, [[200, [0, 0, 0, 1]]]), 100), 3, 'translucent content retained');
assert.equal(count(canvas(201, [[200, [0, 0, 0, 0]]]), 100), 1, 'transparent pixels are blank');
assert.equal(count(canvas(300), 100), 1, 'empty capture retains one PDF page');

// Real export dimensions: 816 CSS px, scale 2, Letter with 36pt margins.
const pageHeight = Math.floor(720 * 1632 / 540);
assert.equal(pageHeight, 2176);
assert.equal(count(canvas(2184, [[2089]], 1632), pageHeight), 1, 'Wesson padding overflow regression');
assert.equal(count(canvas(2184, [[2183]], 1632), pageHeight), 2, 'real second-page content retained');
assert(source.includes('const totalPages = getPdfPageCount(canvas, pxPageHeight);'));
console.log('PASS: 12 PDF pagination cases; blank trailing slices removed, real content and integer slice boundaries preserved.');
