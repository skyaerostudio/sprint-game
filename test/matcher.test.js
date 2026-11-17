// Unit tests for the Satu Dalam Sejuta matcher + bank validation (node --test).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { match, levenshtein, tolerance } = require('../lib/matcher');
const { validate } = require('../lib/promptbank');

const bank = require(path.join(__dirname, '..', 'data', 'prompts.json'));
const P = (id) => bank.prompts.find((p) => p.id === id);
const SS = (id) => bank.sering_salah.filter((s) => s.prompt_id === id);
const m = (id, raw) => match(P(id), raw, SS(id));
const teks = (id, raw) => {
  const r = m(id, raw);
  return r.type === 'found' ? r.answer.teks : r.type;
};

test('bank file passes validation', () => {
  assert.deepEqual(validate(bank), []);
});

test('validation catches broken data', () => {
  const bad = JSON.parse(JSON.stringify(bank));
  bad.prompts[0].jawaban.push({ teks: 'Pisang!', tier: 9 }); // dup after normalization + bad tier
  bad.prompts[1].jawaban.forEach((j) => delete j.mutiara); // no mutiara
  bad.sering_salah.push({ prompt_id: 'nggakada', jawaban: 'X' });
  const errs = validate(bad);
  assert.ok(errs.some((e) => /tier harus 1–5/.test(e)));
  assert.ok(errs.some((e) => /dobel/.test(e)));
  assert.ok(errs.some((e) => /tepat 1 Mutiara/.test(e)));
  assert.ok(errs.some((e) => /prompt_id "nggakada"/.test(e)));
});

test('normalization: case, spaces, dashes, punctuation', () => {
  assert.equal(teks('buah', '  SIRSAK!! '), 'Sirsak');
  assert.equal(teks('olahraga', 'sepak-bola'), 'Sepak Bola');
  assert.equal(teks('olahraga', 'Sepakbola'), 'Sepak Bola');
});

test('category prefix is stripped ("buah matoa" = "matoa")', () => {
  assert.equal(teks('buah', 'buah matoa'), 'Matoa');
  assert.equal(teks('kota', 'Kota Malang'), 'Malang');
  assert.equal(teks('provinsi', 'provinsi gorontalo'), 'Gorontalo');
});

test('prefix strip never beats a real full-name answer (Kotabaru)', () => {
  assert.equal(teks('kota', 'Kotabaru'), 'Kotabaru');
  assert.equal(teks('buah', 'Buah Maja'), 'Maja');
});

test('aliases', () => {
  assert.equal(teks('provinsi', 'Jabar'), 'Jawa Barat');
  assert.equal(teks('olahraga', 'Bola'), 'Sepak Bola');
  assert.equal(teks('buah', 'nangka belanda'), 'Sirsak');
  assert.equal(teks('kota', 'surakarta'), 'Solo');
});

test('exact match always wins over typo (near-twin names)', () => {
  assert.equal(teks('negara', 'Iran'), 'Iran');
  assert.equal(teks('negara', 'Irak'), 'Irak');
  assert.equal(teks('negara', 'Slovakia'), 'Slovakia');
  assert.equal(teks('negara', 'Slovenia'), 'Slovenia');
  assert.equal(teks('kota', 'Solo'), 'Solo');
  assert.equal(teks('kota', 'Solok'), 'Solok');
  assert.equal(teks('profesi', 'Kasir'), 'Kasir');
  assert.equal(teks('profesi', 'Kusir'), 'Kusir');
  assert.equal(teks('kantor', 'AC'), 'AC');
  assert.equal(teks('kantor', 'PC'), 'Komputer');
  assert.equal(teks('provinsi', 'Sumut'), 'Sumatera Utara');
  assert.equal(teks('provinsi', 'Sulut'), 'Sulawesi Utara');
});

test('typo tolerance by length: 0 for ≤4, 1 for 5–8, 2 for longer', () => {
  assert.equal(tolerance(4), 0);
  assert.equal(tolerance(5), 1);
  assert.equal(tolerance(8), 1);
  assert.equal(tolerance(9), 2);
  assert.equal(teks('buah', 'Sirsk'), 'Sirsak'); // 6 letters, 1 edit
  assert.equal(teks('buah', 'Srsk'), 'notfound'); // 2 edits on a 6-letter word
  assert.equal(teks('kantor', 'AX'), 'notfound'); // short words need exact
  assert.equal(teks('hewan', 'Yek'), 'notfound');
  assert.equal(teks('provinsi', 'Sulawsi Selatn'), 'Sulawesi Selatan'); // long word, 2 edits
  assert.equal(teks('hewan', 'kucin'), 'Kucing');
});

test('typo equally close to two answers asks the player', () => {
  // "pramugar" → Pramugari and Pramugara are both 1 edit away.
  const r = m('profesi', 'Pramugar');
  assert.equal(r.type, 'ambiguous');
  assert.deepEqual(r.options.map((a) => a.teks).sort(), ['Pramugara', 'Pramugari']);
  // "Kasur" is 1 edit from Kasir but 2 from Kusir → resolves to Kasir.
  assert.equal(teks('profesi', 'Kasur'), 'Kasir');
  // "Irlndia" is 1 edit from Irlandia, 2 from Islandia → not ambiguous.
  assert.equal(teks('negara', 'Irlndia'), 'Irlandia');
});

test('sering_salah goes to Sidang Banding, never matched', () => {
  const r = m('kota', 'Bali');
  assert.equal(r.type, 'sering_salah');
  assert.match(r.alasan, /bukan kota/i);
  assert.equal(m('negara', 'dubai').type, 'sering_salah');
  assert.equal(m('negara', 'Dubay').type, 'sering_salah'); // typo of a sering_salah entry
});

test('empty and unknown input', () => {
  assert.equal(m('buah', '   ').type, 'empty');
  assert.equal(m('buah', '!!!').type, 'empty');
  assert.equal(m('buah', 'Komputer').type, 'notfound');
});

test('levenshtein', () => {
  assert.equal(levenshtein('kitten', 'sitting', 5), 3);
  assert.equal(levenshtein('abc', 'abc', 0), 0);
  assert.ok(levenshtein('abcdef', 'zzzzzz', 1) > 1);
});
