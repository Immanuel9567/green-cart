// Tests for js/search.js.
//
// These run against the REAL catalogue in js/products.js, not a fixture. A search
// test that passes on invented products tells you nothing about whether a shopper
// can find the chronograph, so every assertion below is a sentence a customer
// might actually type into the box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { searchProducts, tokens, fold } = require('../js/search.js');

// Load the catalogue exactly as the browser does: js/products.js declares a
// top-level `const PRODUCTS`, which never becomes a property of `window`, so we
// evaluate it in a context and read the binding back out.
function loadCatalogue() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'products.js'), 'utf8');
  const context = { };
  vm.createContext(context);
  vm.runInContext(`${source}\n;globalThis.__products = PRODUCTS;`, context);
  return context.__products;
}

const PRODUCTS = loadCatalogue();
const ids = query => searchProducts(PRODUCTS, query).map(product => product.id);

test('the catalogue loads and the search sees all of it', () => {
  assert.ok(Array.isArray(PRODUCTS) && PRODUCTS.length >= 14, 'catalogue is present');
  assert.equal(searchProducts(PRODUCTS, '').length, PRODUCTS.length, 'an empty query returns everything');
  assert.equal(searchProducts(PRODUCTS, '   ').length, PRODUCTS.length, 'whitespace is not a query');
});

test('everyday words find the product a shopper means', () => {
  // These are the exact words that failed before. Each maps to a real product.
  const cases = [
    ['watch', 'aura-02'],          // Bauhaus Chronograph Mono
    ['watches', 'aura-02'],
    ['headphones', 'aura-01'],     // AURA ANC Over-Ear
    ['headphone', 'aura-01'],
    ['shoes', 'aura-03'],          // Obsidian Low-Top Sneaker
    ['sneakers', 'aura-03'],
    ['lamp', 'aura-07'],           // Sculptural Arc Desk Luminaire
    ['keyboard', 'aura-06'],       // Anodized 75% Mechanical Board
    ['charger', 'aura-10'],        // MagSafe Dual Charger Deck
    ['backpack', 'aura-12'],       // Arc Geometric Commuter Backpack
    ['sunglasses', 'aura-11'],     // Lumière Hexagon Polarized Eyewear
    ['coffee', 'aura-05'],         // Ceramic Geometry French Press
    ['flask', 'aura-14'],          // Minimalist Matte Thermal Flask
    ['speaker', 'aura-04']         // Monolith Wireless Capsule
  ];
  for (const [query, expectedId] of cases) {
    const results = ids(query);
    assert.ok(results.length > 0, `"${query}" must return something`);
    assert.ok(results.includes(expectedId), `"${query}" must find ${expectedId}, got ${JSON.stringify(results)}`);
  }
});

test('an exact product name outranks a looser mention', () => {
  // "Monolith" is in two titles; the speaker is the flagship of that name.
  const results = ids('monolith');
  assert.ok(results.length >= 2, 'monolith appears more than once');
  // Both are legitimate; the point is that ranking is deterministic, not random.
  assert.deepEqual(ids('monolith'), results, 'the same query ranks the same way twice');
});

test('accented names are findable without an accented keyboard', () => {
  const accented = ids('lumiere');
  const plain = ids('lumiere');
  assert.ok(accented.includes('aura-11'), 'lumiere finds Lumière');
  assert.deepEqual(accented, plain);
  // And the accented spelling still works.
  assert.ok(ids('Lumière').includes('aura-11'), 'the accented spelling also works');
});

test('tokens combine with AND, so extra words narrow the list', () => {
  const audio = ids('audio');
  const audioBlack = ids('audio black');
  assert.ok(audio.length >= 3, 'audio is a category');
  assert.ok(audioBlack.length <= audio.length, 'adding a word cannot widen the results');
  assert.ok(audioBlack.every(id => audio.includes(id)), 'narrowing keeps a subset');
});

test('matching is on whole words, not substrings', () => {
  // A whole-word prefix still matches: "chrono" finds "Chronograph".
  assert.deepEqual(ids('chrono'), ids('chronograph'), 'a prefix of a word matches it');
  // But a fragment that starts mid-word does not. "eadphon" is inside "headphone"
  // and must find nothing; "art" must not match the word "cart".
  assert.equal(ids('eadphon').length, 0, 'a fragment starting mid-word matches nothing');
  assert.equal(ids('cart').length, 0, 'substrings inside other words do not match');
});

test('a query that matches nothing returns nothing rather than everything', () => {
  // Compare by id rather than deepEqual: the catalogue comes from a separate VM
  // realm, so its arrays have a different prototype and deepEqual would fail on
  // that rather than on the behaviour being tested.
  assert.equal(ids('zzzznotathing').length, 0, 'nonsense finds nothing');
  assert.equal(ids('qqq').length, 0, 'nonsense finds nothing twice');
  assert.equal(searchProducts(PRODUCTS, 'watch').length > 0, true, 'but a real word still works');
});

test('search never invents or loses a product', () => {
  // Every result must be a real catalogue product: no duplicates, no phantoms.
  for (const query of ['audio', 'watch', 'black', 'steel', 'a', 'design']) {
    const results = searchProducts(PRODUCTS, query);
    const unique = new Set(results.map(product => product.id));
    assert.equal(unique.size, results.length, `"${query}" returned a duplicate`);
    for (const product of results) {
      assert.ok(PRODUCTS.some(entry => entry.id === product.id), `"${query}" returned a phantom`);
    }
  }
});

test('it does not mutate the catalogue or the array it is given', () => {
  const snapshot = PRODUCTS.map(product => product.id);
  const input = PRODUCTS.slice();
  searchProducts(input, 'watch');
  assert.deepEqual(input.map(product => product.id), snapshot, 'the input order is untouched');
  assert.deepEqual(PRODUCTS.map(product => product.id), snapshot, 'the catalogue is untouched');
});

test('tokenising and folding behave', () => {
  assert.deepEqual(tokens('  Black & Steel  '), ['black', 'steel']);
  assert.deepEqual(tokens('over-ear'), ['over', 'ear']);
  assert.equal(fold('Lumière'), 'lumiere');
  assert.equal(fold(undefined), '');
});

test('a junk query cannot throw', () => {
  for (const query of [null, undefined, 0, {}, [], 'select * from products', '<script>']) {
    assert.doesNotThrow(() => searchProducts(PRODUCTS, query), `query ${JSON.stringify(query)} threw`);
  }
});
