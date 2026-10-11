const assert = require('node:assert/strict');
const { createStore, createDepartmentStore, FIELD_IDS, SECTION_KEYS } = require('../recent-bios.js');
const bio = (id, excluded = []) => ({ version: 1, id, identity: id, name: 'Synthetic ' + id,
  source: 'Synthetic complete source', createdAt: 1000, updatedAt: 1000, fontSize: 14, editable: true,
  photoSrc: 'data:image/png;base64,AAAA', fields: Object.fromEntries(FIELD_IDS.map(key => [key, 'Synthetic ' + key])),
  sections: Object.fromEntries(SECTION_KEYS.map(key => [key, { hidden: excluded.includes(key), checked: !excluded.includes(key) }])) });
async function run() {
  const values = new Map();
  const env = { localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } };
  const presets = [bio('one', ['certifications', 'locations']), bio('two', ['locations']), bio('three')];
  const connect = seeds => createDepartmentStore(env, 'front-desk', seeds || presets);
  let store = connect();
  assert.equal((await store.list()).items.length, 3);
  assert.equal(values.size, 0, 'Bundled presets are available without rewriting browser storage');
  const edited = { ...presets[0], updatedAt: 2000, fields: { ...presets[0].fields, backgroundField: 'Local edit' } };
  await store.save(edited);
  const newerCatalog = presets.map(item => ({ ...item, updatedAt: 3000 }));
  assert.equal((await connect(newerCatalog).list()).items.find(item => item.id === 'one').fields.backgroundField, 'Local edit', 'Catalog refresh never overwrites local content');
  assert.deepEqual((await connect(newerCatalog).list()).items.find(item => item.id === 'one').sections, edited.sections);
  await store.remove('one'); await store.remove('one');
  assert.equal((await connect().list()).items.length, 2, 'Removed preset stays removed across reconnect and repeated deletion');
  const raw = JSON.parse([...values.values()][0]).items.find(item => item.id === 'one');
  assert.equal(raw.source, ''); assert.equal(raw.photoSrc, '', 'Removal markers retain no source or portrait');
  assert.equal((await createDepartmentStore(env, 'front-desk').list()).items.length, 0, 'A removed catalog does not expose removal markers as doctors');
  await store.restore([edited]);
  assert.equal((await connect().list()).items.length, 3);
  assert.deepEqual((await connect().list()).items.find(item => item.id === 'two').sections, presets[1].sections, 'Different doctor exclusions remain independent');
  await createStore(env).save(bio('recent')); await createStore(env).clear();
  assert.equal((await connect().list()).items.length, 3, 'Recent clear cannot remove bundled entries');
  const extended = [...presets, bio('later')];
  assert.equal((await connect(extended).list()).items.length, 4, 'New roster entries appear without replacing local edits');
  await store.clear();
  assert.equal((await connect().list()).items.length, 0);
  assert.throws(() => connect([{ ...presets[0], photoSrc: null }]), /Invalid/, 'Incomplete portraits cannot become presets');
  assert.throws(() => connect([presets[0], presets[0]]), /Duplicate/);
  console.log('PASS: bundled defaults, local edit precedence, independent exclusions, persistent removal/undo, no source/photo in removal markers, safe catalog refresh, history-clear isolation, incomplete/duplicate preset rejection');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
