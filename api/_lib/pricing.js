// Server-side order pricing.
//
// The browser has a copy of the catalogue and a cart, and it can send whatever
// it likes in the request body. None of it is trusted. This module takes the
// lines the browser claims it wants, looks every price up in the server's own
// catalogue, and computes the total again.
//
// It reuses the SAME calculations as the storefront by constructing the store
// with an in-memory storage. That is deliberate: if the server and the browser
// each had their own copy of the discount and shipping rules, they would drift,
// and the customer would be charged one number while seeing another.

const path = require('node:path');

// The catalogue ships to the browser as a plain script, and it also exports for
// Node. Requiring it here means the server prices from the file that is in the
// repository, not from a duplicate that can rot.
const { PRODUCTS } = require(path.join(__dirname, '..', '..', 'js', 'products.js'));
const { Store } = require(path.join(__dirname, '..', '..', 'js', 'store.js'));

// Orders in this store are recorded in US dollars. Naira is a display currency,
// converted at the pinned rate, so the amount charged and the amount recorded
// are two representations of one value rather than two competing ones.
//
// The rate is read from js/config.js rather than copied, because a second copy
// is a second thing to forget to update. js/config.js expects a `window`; a
// throwaway one lets Node load it unchanged.
function readRateFromConfig() {
  const module = { exports: {} };
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', '..', 'js', 'config.js'), 'utf8');
  const sandbox = { window: {} };
  new Function('window', source)(sandbox.window);
  const rate = Number(sandbox.window.GREENCART_CONFIG.currency.ngnPerUsd);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('js/config.js has an unusable currency.ngnPerUsd.');
  }
  return rate;
}

const NGN_PER_USD = readRateFromConfig();

function memoryStorage() {
  const map = new Map();
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: key => { map.delete(key); }
  };
}

function newStore() {
  return new Store(PRODUCTS, memoryStorage());
}

class QuoteError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
    this.name = 'QuoteError';
  }
}

// `lines` is [{ id, quantity }] as sent by the browser. Everything about it is
// suspect: the id may not exist, the quantity may be negative, fractional,
// enormous, or larger than the shelf.
function normaliseLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    throw new QuoteError('No items were supplied.');
  }
  if (rawLines.length > 50) {
    throw new QuoteError('Too many items in one order.');
  }
  const seen = new Map();
  for (const line of rawLines) {
    const id = String((line && line.id) || '').trim();
    const quantity = Number(line && line.quantity);
    if (!id) throw new QuoteError('An item in the cart had no identifier.');
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new QuoteError('Every item needs a whole quantity of at least one.');
    }
    if (quantity > 99) throw new QuoteError('A single item cannot exceed 99 units.');
    seen.set(id, (seen.get(id) || 0) + quantity);
  }
  return Array.from(seen, ([id, quantity]) => ({ id, quantity }));
}

// The public entry point used by the checkout handler.
function priceOrder({ lines, promo }) {
  if (!Array.isArray(lines) || lines.length === 0) throw new QuoteError('No items were supplied.');
  const store = newStore();
  for (const line of normaliseLines(lines)) {
    const product = store.products.find(item => item.id === line.id);
    if (!product) throw new QuoteError(`An item in your bag is no longer available (${line.id}).`, 409);
    if (!product.inStock || product.stock < line.quantity) {
      throw new QuoteError(`${product.title} does not have that many left.`, 409);
    }
    store.addToCart(product.id, line.quantity);
  }
  if (promo) {
    try { store.applyPromo(String(promo)); } catch (_) { /* ignored on purpose */ }
  }
  const totals = store.getCartTotals();
  const items = store.cart.map(line => {
    const product = store.products.find(item => item.id === line.id);
    return {
      id: product.id,
      title: product.title,
      price: product.price,
      quantity: line.quantity,
      image: product.image
    };
  });
  return { items, totals };
}

// USD -> the amount to send Paystack, in kobo.
// Two conversions, both required: dollars to naira at the pinned rate, then
// naira to kobo. Skipping the first would charge 299 kobo for a 299 dollar
// item, which is how a store sells headphones for three dollars.
function toKobo(usdAmount) {
  return Math.round(Number(usdAmount) * NGN_PER_USD * 100);
}

// Kobo -> naira. Paystack reports what it charged in kobo; this is the human
// figure.
function koboToNaira(kobo) {
  return Math.round(Number(kobo)) / 100;
}

// Kobo -> the USD value the order is recorded in. Dividing by the same pinned
// rate used to charge keeps the round trip consistent: 40,305,798 kobo comes
// back as 299 USD, not 402,057.
function koboToUsd(kobo) {
  return Math.round((Math.round(Number(kobo)) / 100 / NGN_PER_USD) * 100) / 100;
}

module.exports = {
  QuoteError,
  priceOrder,
  normaliseLines,
  toKobo,
  koboToNaira,
  koboToUsd,
  NGN_PER_USD,
  newStore
};
