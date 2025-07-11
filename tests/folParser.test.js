const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FOLLocalStore } = require('../dist/cjs/intent/modules/fol/store/local.js');

describe('parseFactValue in FOLLocalStore', () => {
  let dir;
  let store;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fol-'));
    store = new FOLLocalStore(dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const saveAndRead = async (value) => {
    await store.saveFacts({ constants: [], predicates: [], facts: [{ value, description: '' }] });
    const all = await store.getAllFols();
    return all.facts[0];
  };

  test('universal quantifier case', async () => {
    const fact = await saveAndRead('∀c ((Campus(c) ∧ HasCampus(hanyang_university, c)) → (c = seoul_campus ∨ c = erica_campus))');
    expect(fact.predicates.sort()).toEqual(['Campus', 'HasCampus']);
    expect(fact.contants.sort()).toEqual(['erica_campus', 'hanyang_university', 'seoul_campus']);
  });

  test('conjunction case', async () => {
    const fact = await saveAndRead('HasCampus(hanyang_university, seoul_campus) ∧ HasCampus(hanyang_university, erica_campus)');
    expect(fact.predicates.sort()).toEqual(['HasCampus']);
    expect(fact.contants.sort()).toEqual(['erica_campus', 'hanyang_university', 'seoul_campus']);
  });
});
