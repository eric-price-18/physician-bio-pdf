const assert = require('node:assert/strict');
const { createStore, FIELD_IDS, SECTION_KEYS, KEY } = require('../recent-bios.js');
function bio(id, time) {
  return { version: 1, id, identity: id, name: 'Test Physician ' + id, source: 'Fictional source',
    createdAt: time, updatedAt: time, fields: Object.fromEntries(FIELD_IDS.map(id => [id, 'Edited text'])),
    sections: Object.fromEntries(SECTION_KEYS.map(key => [key, { hidden: false, checked: true }])),
    fontSize: 14, editable: true, photoSrc: '' };
}

// Asynchronous transactional memory double; never touches browser or disk storage.
function indexedDB(records, quota) {
  const db = { close() {}, transaction() {
    const staged = new Map(records);
    const tx = { abort() { tx.aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() {
      return { getAll() {
        const request = {};
        queueMicrotask(() => {
          request.result = [...staged.values()];
          request.onsuccess();
          queueMicrotask(() => {
            if (tx.aborted) return;
            records.clear(); staged.forEach((value, key) => records.set(key, value));
            tx.oncomplete();
          });
        });
        return request;
      }, clear() { staged.clear(); }, put(item) {
        if (quota?.fail) throw new Error('QuotaExceededError');
        staged.set(item.id, item);
      } };
    } };
    return tx;
  } };
  return { open() { const request = { result: db }; queueMicrotask(() => request.onsuccess()); return request; } };
}

async function run() {
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const records = new Map([['primary', bio('primary', 1000)]]);
  const primary = { localStorage, indexedDB: indexedDB(records) };
  const offline = { localStorage };
  await createStore(offline).save(bio('fallback', 2000));
  let result = await createStore(primary).list();
  assert.deepEqual(result.items.map(item => item.id), ['fallback', 'primary']);
  assert.equal(JSON.parse(values.get(KEY)).items.length, 0);
  await createStore(offline).remove('primary');
  result = await createStore(primary).list();
  assert.deepEqual(result.items.map(item => item.id), ['fallback']);
  await createStore(offline).save(bio('new-offline', 3000));
  result = await createStore(primary).list();
  assert.deepEqual(result.items.map(item => item.id), ['new-offline', 'fallback']);
  const removed = result.items;
  await createStore(offline).clear();
  assert.equal((await createStore(primary).list()).items.length, 0);
  assert.equal(records.size, 0);
  await createStore(offline).clear();
  await createStore(offline).restore(removed);
  assert.equal((await createStore(primary).list()).items.length, 2);

  await createStore(offline).save(bio('quota', 4000));
  const before = values.get(KEY);
  const quota = { fail: true };
  await assert.rejects(createStore({ localStorage, indexedDB: indexedDB(records, quota) }).list());
  assert.equal(values.get(KEY), before, 'Migration failure preserves fallback saves');
  assert.equal(records.has('quota'), false, 'Migration failure preserves the committed database');
  quota.fail = false;
  assert.equal((await createStore(primary).list()).items[0].id, 'quota');

  // Deleting while migration is pending must not resurrect a stale fallback copy.
  await createStore(offline).save(bio('quota', 4500));
  await createStore(primary).remove('quota');
  assert.equal((await createStore(offline).list()).items.length, 0);
  assert.equal((await createStore(primary).list()).items.some(item => item.id === 'quota'), false);
  const blockedLocal = { getItem() { throw new Error('SecurityError'); } };
  assert.equal((await createStore({ localStorage: blockedLocal, indexedDB: primary.indexedDB }).list()).items.length, 2);
  records.set('primary-copy', { ...bio('primary-copy', 5000), identity: 'same-physician' });
  await createStore(offline).save({ ...bio('fallback-copy', 6000), identity: 'same-physician' });
  await createStore(offline).remove('fallback-copy');
  assert.equal((await createStore(primary).list()).items.some(item => item.identity === 'same-physician'), false,
    'Deleting an offline duplicate also removes its older primary record');
  console.log('PASS: fallback migration, offline delete/clear, undo after clear, migration quota preservation, no resurrection, IndexedDB with blocked localStorage');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
