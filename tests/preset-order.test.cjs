const assert = require('node:assert/strict');
const { createPresetStore, normalize } = require('../recent-bios.js');
require('../department-bios.js');
(async () => {
 const defaults = globalThis.DepartmentBios['front-desk'];
 const original = JSON.stringify(defaults);
 const ordered = (await createPresetStore(defaults).list()).items;
 assert.deepEqual(ordered.map(x=>x.name), ['Matthew Czarny, MD','Calin Maniu, MD','Julie M. Miller, MD','Faisal Rahman, BMBCh','Jeff Trost, MD']);
 assert.equal(JSON.stringify(defaults), original);
 for(const item of ordered) assert.deepEqual(item, defaults.find(x=>x.id===item.id));
 const sample = ['Zoe Smith, MD', 'Amy Smith, BMBCh', 'Alan Jones MD', 'Dr. Ben Adams Jr., MD', 'Cara O\'Neil, MD', 'Deb van Meer, MD'].map((name,i)=>({...defaults[0], id:'test-'+i, identity:'test-'+i, name, updatedAt:100+i}));
 sample[5].lastName='van Meer'; sample[5].firstName='Deb';
 assert.deepEqual((await createPresetStore(sample).list()).items.map(x=>x.name), [sample[3].name,sample[2].name,sample[4].name,sample[1].name,sample[0].name,sample[5].name]);
 assert.deepEqual(normalize(sample).map(x=>x.id),sample.slice().reverse().map(x=>x.id));
 console.log('PASS: surname order, credential/suffix removal, structured names, given-name ties, exact snapshots, unchanged Recent recency');
})();
