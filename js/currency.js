// Currency display for GreenCart.
//
// Every price in js/products.js is stored in US dollars. This module converts
// for DISPLAY ONLY. It never rewrites a stored price, never alters an order
// total, and never feeds a converted number back into the store. That is the
// rule that keeps a ₦ order and a $ order describing the same value, and stops
// a rate change from silently repricing things a customer already bought.
//
// This module formats prices for display and nothing else. It deliberately does
// NOT convert a price into a charge amount: that happens once, on the server, in
// api/_lib/pricing.js. Having a second converter here would be two places
// computing money, which is how a store ends up charging a different figure from
// the one it showed.
//
// The rate itself is hand-pinned in js/config.js with the date it was checked.
// A browser-only store cannot fetch a live rate at checkout and still be able
// to prove the amount it charged, so the rate is stated rather than fetched.

(function () {
  const CONFIG = window.GREENCART_CONFIG || {};
  const CURRENCY_CONFIG = CONFIG.currency || {};

  const STORAGE_KEY = 'greencart_currency_v1';
  const BASE = CURRENCY_CONFIG.base || 'USD';
  const SUPPORTED = ['USD', 'NGN'];

  // Round-trip the configured rate so a typo like 1348.02 -> "1348,02" cannot
  // quietly become NaN and render every price as ₦0.
  const rate = Number(CURRENCY_CONFIG.ngnPerUsd);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('js/config.js: currency.ngnPerUsd must be a positive number.');
  }

  const formatters = {
    USD: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    // Naira sums are large and kobo are never used in retail pricing here, so
    // whole naira keeps ₦403,058 readable instead of ₦403,058.00.
    NGN: new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 })
  };

  const symbols = { USD: '$', NGN: '₦' };

  function normalize(code) {
    const upper = String(code || '').toUpperCase();
    return SUPPORTED.includes(upper) ? upper : null;
  }

  function readStored() {
    try {
      const value = window.localStorage.getItem(STORAGE_KEY);
      return normalize(value);
    } catch (_) {
      // Private modes and blocked storage must not stop the store rendering.
      return null;
    }
  }

  function writeStored(code) {
    try {
      window.localStorage.setItem(STORAGE_KEY, code);
    } catch (_) {
      // The choice simply will not persist. Not worth an error to the shopper.
    }
  }

  let active = readStored() || normalize(CURRENCY_CONFIG.default) || BASE;

  function get() {
    return active;
  }

  function set(code) {
    const next = normalize(code);
    if (!next) throw new Error('Unknown currency: ' + code);
    active = next;
    writeStored(next);
    return active;
  }

  function toggle() {
    return set(active === 'NGN' ? 'USD' : 'NGN');
  }

  // USD -> the active currency, as a Number. Used for display and for building
  // a payment amount; the store's own totals stay in USD regardless.
  function convert(usdAmount) {
    const value = Number(usdAmount);
    if (!Number.isFinite(value)) return 0;
    if (active === 'USD') return value;
    return value * rate;
  }

  function format(usdAmount) {
    return formatters[active].format(convert(usdAmount));
  }

  function label(code) {
    return normalize(code) || active;
  }

  function rateInfo() {
    return {
      base: BASE,
      rate: rate,
      checked: CURRENCY_CONFIG.rateChecked || '',
      source: CURRENCY_CONFIG.rateSource || ''
    };
  }

  window.GreenCartCurrency = {
    supported: SUPPORTED.slice(),
    symbols,
    get,
    set,
    toggle,
    convert,
    format,
    label,
    rateInfo
  };
})();
