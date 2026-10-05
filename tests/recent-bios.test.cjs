const assert = require('node:assert/strict');
const { createStore, FIELD_IDS, SECTION_KEYS, KEY, validItem } = require('../recent-bios.js');
function bio(id, updatedAt = Date.now()) {
  return { version: 1, id, identity: id, name: 'Test Physician ' + id, source: 'Test source',
    createdAt: updatedAt, updatedAt, fields: Object.fromEntries(FIELD_IDS.map(id => [id, 'Test'])),
    sections: Object.fromEntries(SECTION_KEYS.map(key => [key, { hidden: false, checked: true }])),
    fontSize: 14, editable: true, photoSrc: '' };
}
async function run() {
  const values = new Map();
  let fail = false;
  const env = { localStorage: { getItem: key => values.get(key) || null,
    setItem: (key, value) => { if (fail) throw new Error('QuotaExceededError'); values.set(key, value); } } };
  let store = createStore(env);
  assert.equal((await store.list()).items.length, 0);
  await store.save(bio('one', 1000));
  await store.save({...bio('one', 2000), name: 'Edited Physician', fields: {...bio('one').fields, backgroundField: 'Edited background'}});
  store = createStore(env);
  let result = await store.list();
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].fields.backgroundField, 'Edited background');
  assert.equal(result.items[0].name, 'Edited Physician');
  for (let i = 0; i < 15; i++) await store.save(bio('test-' + i, 3000 + i));
  result = await store.list();
  assert.equal(result.items.length, 12);
  assert.equal(result.items[0].id, 'test-14');
  assert.equal(result.items[11].id, 'test-3');
  await store.save({...bio('new-id', 4000), identity: 'test-14'});
  assert.equal((await store.list()).items.filter(item => item.identity === 'test-14').length, 1);
  await store.remove('new-id');
  assert.equal((await store.list()).items.length, 11);
  const old = (await store.list()).items;
  await store.clear();
  assert.equal((await createStore(env).list()).items.length, 0);
  await store.restore(old);
  assert.equal((await store.list()).items.length, 11);
  const before = values.get(KEY);
  fail = true;
  await assert.rejects(store.save(bio('quota')));
  assert.equal(values.get(KEY), before);
  fail = false;
  values.set(KEY, '{broken json');
  result = await createStore(env).list();
  assert.equal(result.items.length, 0);
  assert.match(result.warning, /could not be read/);
  await store.save(bio('recovered'));
  values.set(KEY, JSON.stringify({version: 1, items: [bio('valid'), {id:'bad'}, {...bio('remote'), photoSrc:'https://example.com/private.jpg'}]}));
  result = await createStore(env).list();
  assert.equal(result.items.length, 1);
  assert.match(result.warning, /skipped/);
  assert.equal(validItem({...bio('bad-date'), updatedAt: 1e20}), false);
  assert.equal(validItem({...bio('script'), photoSrc:'data:image/svg+xml;base64,PHN2Zz4='}), false);
  await assert.rejects(createStore({localStorage:{getItem(){throw new Error('SecurityError');}}}).list());
  console.log('PASS: fallback persistence, edited fields, deduplication, 12-item limit, delete, clear, undo, quota preservation, corrupt JSON/records, unsafe URLs, blocked storage');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
