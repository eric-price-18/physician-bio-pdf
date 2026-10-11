const assert = require('node:assert/strict');
const { createStore, createDepartmentStore, DEPARTMENTS, FIELD_IDS, SECTION_KEYS, KEY } = require('../recent-bios.js');
const bio = (id, time) => ({ version: 1, id, identity: id, name: 'Synthetic Physician ' + id,
  source: 'Synthetic source', createdAt: time, updatedAt: time, fontSize: 16, editable: true,
  photoSrc: 'data:image/png;base64,AAAA',
  fields: Object.fromEntries(FIELD_IDS.map(key => [key, 'Edited ' + key])),
  sections: Object.fromEntries(SECTION_KEYS.map(key => [key, { hidden: key === 'gender', checked: key !== 'gender' }])) });

async function run() {
  const values = new Map();
  let full = false;
  const env = { localStorage: { getItem: key => values.get(key) || null,
    setItem(key, value) { if (full) throw new Error('QuotaExceededError'); values.set(key, value); } } };
  const legacy = Array.from({ length: 20 }, (_, i) => bio('legacy-' + i, 1000 + i));
  const original = JSON.stringify({ version: 1, items: legacy });
  values.set(KEY, original);
  assert.deepEqual(DEPARTMENTS, [{ id: 'front-desk', name: 'Cath Lab' }]);
  assert.throws(() => createDepartmentStore(env, 'unknown'));
  const department = createDepartmentStore(env, 'front-desk');
  assert.equal((await department.list()).items.length, 0, 'No invented roster');
  assert.equal(values.get(KEY), original, 'Opening departments leaves legacy history bytes untouched');
  for (const item of legacy) await department.save(item);
  for (let i = 20; i < 45; i++) await department.save(bio('permanent-' + i, 2000 + i));
  const permanent = (await department.list()).items;
  assert.equal(permanent.length, 45, 'Departments are not capped at 20');
  assert.equal(values.get(KEY), original, 'Department writes do not migrate or alter recent data');
  const history = createStore(env);
  assert.equal((await history.list()).items.length, 20, 'All legacy records still read');
  for (let i = 0; i < 25; i++) await history.save(bio('recent-' + i, 3000 + i));
  assert.equal((await history.list()).items.length, 20);
  assert.deepEqual((await department.list()).items, permanent, 'Eviction never modifies department bios');
  await history.clear();
  assert.deepEqual((await createDepartmentStore(env, 'front-desk').list()).items, permanent, 'Clear and reconnect preserve department content, categories, source, photo, font');
  const before = new Map(values);
  full = true;
  await assert.rejects(department.save(bio('quota', 5000)));
  assert.deepEqual(values, before, 'Failed department writes preserve existing data');
  full = false;
  await department.remove(permanent[0].id);
  await department.restore([permanent[0]]);
  assert.deepEqual((await department.list()).items, permanent);
  assert.equal((await history.list()).items.length, 0, 'Department undo cannot resurrect Recent bios');
  console.log('PASS: named empty department, separate storage keys, unchanged legacy bytes, unlimited department retention, history eviction/clear isolation, full snapshot persistence, quota preservation, isolated remove/undo');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
