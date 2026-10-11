const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validItem, createDepartmentStore } = require('../recent-bios.js');
require('../department-bios.js');
const expected = [
  {
    "name": "Matthew Czarny, MD",
    "id": "preset-cath-lab-matthew-czarny",
    "sourceHash": "815d534744337ac8cfdb8d92aeeac05976fc52cd64ec28e2804a9271e4309378",
    "photoHash": "3f4cf92982da7c825d121028f3794d73355aebe7718fa18dcf3b7f0b63bb8898",
    "sections": {
      "affiliations": {
        "hidden": false,
        "checked": true
      },
      "languages": {
        "hidden": false,
        "checked": true
      },
      "gender": {
        "hidden": false,
        "checked": true
      },
      "titles": {
        "hidden": false,
        "checked": true
      },
      "academic": {
        "hidden": false,
        "checked": true
      },
      "background": {
        "hidden": false,
        "checked": true
      },
      "education": {
        "hidden": false,
        "checked": true
      },
      "certifications": {
        "hidden": true,
        "checked": false
      },
      "memberships": {
        "hidden": true,
        "checked": false
      },
      "locations": {
        "hidden": true,
        "checked": false
      }
    }
  },
  {
    "name": "Jeff Trost, MD",
    "id": "preset-cath-lab-jeff-trost",
    "sourceHash": "5e6f3f6335ff226825341c6edc8fe7dcb38c3e194c705796f6b9bb66a971f8ab",
    "photoHash": "f6da790ef1eefbae97253f3365466cd3df585ce616d350aaece8201e6d7e063c",
    "sections": {
      "affiliations": {
        "hidden": false,
        "checked": true
      },
      "languages": {
        "hidden": false,
        "checked": true
      },
      "gender": {
        "hidden": false,
        "checked": true
      },
      "titles": {
        "hidden": false,
        "checked": true
      },
      "academic": {
        "hidden": false,
        "checked": true
      },
      "background": {
        "hidden": false,
        "checked": true
      },
      "education": {
        "hidden": false,
        "checked": true
      },
      "certifications": {
        "hidden": false,
        "checked": true
      },
      "memberships": {
        "hidden": true,
        "checked": false
      },
      "locations": {
        "hidden": true,
        "checked": false
      }
    }
  },
  {
    "name": "Calin Maniu, MD",
    "id": "preset-cath-lab-calin-maniu",
    "sourceHash": "6e7b1ef5f4e1a3f4e6c1b6cfcbbbc7b99a64abbee00f3c912bf7897ba83a5c8f",
    "photoHash": "9d4321fffa2dab988cd59756e771572df48ccec876372de5a24530a7bfb38b03",
    "sections": {
      "affiliations": {
        "hidden": false,
        "checked": true
      },
      "languages": {
        "hidden": false,
        "checked": true
      },
      "gender": {
        "hidden": false,
        "checked": true
      },
      "titles": {
        "hidden": true,
        "checked": false
      },
      "academic": {
        "hidden": false,
        "checked": true
      },
      "background": {
        "hidden": false,
        "checked": true
      },
      "education": {
        "hidden": false,
        "checked": true
      },
      "certifications": {
        "hidden": false,
        "checked": true
      },
      "memberships": {
        "hidden": true,
        "checked": false
      },
      "locations": {
        "hidden": false,
        "checked": true
      }
    }
  },
  {
    "name": "Julie M. Miller, MD",
    "id": "preset-cath-lab-julie-m-miller",
    "sourceHash": "8c2c1c353878d0ec1a1b9013894ff38103fd4e2d8a4c9296d2230c3f5c28d34e",
    "photoHash": "506539978991ffadd1866e734639cb335bd77d71c3a5a82e48dba7b4c15b92d2",
    "sections": {
      "affiliations": {
        "hidden": false,
        "checked": true
      },
      "languages": {
        "hidden": false,
        "checked": true
      },
      "gender": {
        "hidden": false,
        "checked": true
      },
      "titles": {
        "hidden": true,
        "checked": false
      },
      "academic": {
        "hidden": false,
        "checked": true
      },
      "background": {
        "hidden": false,
        "checked": true
      },
      "education": {
        "hidden": true,
        "checked": false
      },
      "certifications": {
        "hidden": true,
        "checked": false
      },
      "memberships": {
        "hidden": true,
        "checked": false
      },
      "locations": {
        "hidden": true,
        "checked": false
      }
    }
  },
  {
    "name": "Faisal Rahman, BMBCh",
    "id": "preset-cath-lab-faisal-rahman",
    "sourceHash": "b136b35e9d996b859ab9d2a165c625452179effbc3f94ce77aacedfef886864e",
    "photoHash": "64ae334820e0186b7d909bfb38aae257370c0b983223c73ca5e083f6996b5432",
    "sections": {
      "affiliations": {
        "hidden": false,
        "checked": true
      },
      "languages": {
        "hidden": false,
        "checked": true
      },
      "gender": {
        "hidden": false,
        "checked": true
      },
      "titles": {
        "hidden": false,
        "checked": true
      },
      "academic": {
        "hidden": false,
        "checked": true
      },
      "background": {
        "hidden": false,
        "checked": true
      },
      "education": {
        "hidden": true,
        "checked": false
      },
      "certifications": {
        "hidden": true,
        "checked": false
      },
      "memberships": {
        "hidden": true,
        "checked": false
      },
      "locations": {
        "hidden": true,
        "checked": false
      }
    }
  }
];
const bios = global.DepartmentBios['front-desk'];
assert.equal(bios.length, 5);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (let i = 0; i < expected.length; i++) {
 const actual = bios[i], check = expected[i];
 assert(validItem(actual));
 assert.equal(actual.name, check.name); assert.equal(actual.id, check.id);
 assert.equal(hash(Buffer.from(actual.source, 'utf8')), check.sourceHash);
 assert.equal(hash(Buffer.from(actual.photoSrc.split(',')[1], 'base64')), check.photoHash);
 assert.deepEqual(actual.sections, check.sections);
 assert.equal(actual.fields.nameField, check.name);
 assert(!Object.values(actual.fields).some(text => /<script|onerror=|javascript:/i.test(text)));
}
(async () => {
 const store = createDepartmentStore({localStorage: {getItem: () => null}}, 'front-desk', bios);
 assert.equal((await store.list()).items.length, 5);
 console.log('PASS: exact five Cath Lab bios; original source and paired-photo hashes; doctor-specific exclusions; valid safe snapshots; fresh storage roster');
})().catch(error => { console.error(error); process.exitCode = 1; });
