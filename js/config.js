// GreenCart runtime configuration.
//
// Nothing in this file is secret, and nothing in this file may ever become
// secret. It ships to every visitor's browser, so a key placed here is a key
// given away. The payment provider's SECRET key and the endpoint that verifies
// a charge both live on a server; docs/PAYMENTS.md describes that server.
//
// Read this file top to bottom before changing a value. Each block explains
// what breaks if it is wrong.

// Values may be supplied before this file runs (a deployment that injects keys
// at build time, or a test harness) by pre-defining window.GREENCART_CONFIG.
// Anything supplied wins over the defaults below, so real keys never have to be
// committed to this repository.
const GREENCART_DEFAULTS = {
  // ---------------------------------------------------------------------------
  // Prices
  // ---------------------------------------------------------------------------
  // Catalogue prices stay in US dollars exactly as recorded in js/products.js.
  // They are never rewritten when the display currency changes, so flipping the
  // toggle cannot change what an order is worth, and an order placed in naira
  // still reconciles against the same dollar figures tomorrow.
  currency: {
    base: 'USD',
    // Which currency the store opens in.
    default: 'NGN',
    // USD -> NGN. Checked 2026-11-06 against open.er-api.com (exchangerate-api).
    // This is a hand-pinned rate, not a live feed: a browser-only store cannot
    // fetch a rate at checkout without a server to verify the order against.
    // Re-pin it regularly and keep the date honest — a stale rate shown as if
    // it were current is the same class of lie as a fake payment button.
    ngnPerUsd: 1348.02,
    rateChecked: '2026-11-06',
    rateSource: 'exchangerate-api.com'
  },

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------
  // Card checkout through Paystack is OFF until BOTH values below are filled in
  // by the project owner. With either missing, the checkout says plainly that
  // payments are not switched on yet and refuses to collect an order. That is
  // deliberate: an order nobody receives is worse than a store that admits it
  // is not ready.
  payments: {
    provider: 'paystack',

    // The PUBLIC key from the owner's Paystack dashboard. Paystack public keys
    // start with "pk_". This one is safe to ship; it can only start a payment,
    // never move money or read transaction history.
    publicKey: '',

    // The endpoints deployed with this repository (see api/). The browser asks
    // initializeUrl how much to charge, because only the server is allowed to
    // price an order; and it asks verifyUrl whether the charge succeeded,
    // because only the server is allowed to confirm one.
    //
    // Both must be HTTPS. Leaving either blank keeps payments disabled — that
    // is the guard against "the browser says it worked".
    initializeUrl: '/api/initialize-payment',
    verifyUrl: '/api/verify-payment'
    // Note: there is deliberately no amount conversion here. The browser shows
    // prices; the server alone turns a price into a charge, in
    // api/_lib/pricing.js. See the comment at the top of js/currency.js.
  }
};

function greencartMerge(defaults, overrides) {
  if (!overrides || typeof overrides !== 'object') return defaults;
  const merged = Object.assign({}, defaults);
  Object.keys(overrides).forEach(key => {
    const value = overrides[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && defaults[key]) {
      merged[key] = Object.assign({}, defaults[key], value);
    } else if (value !== undefined) {
      merged[key] = value;
    }
  });
  return merged;
}

window.GREENCART_CONFIG = greencartMerge(GREENCART_DEFAULTS, window.GREENCART_CONFIG);
