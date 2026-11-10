// Tests for the checkout's honesty rules.
//
// These are the tests that matter most in this repository. A storefront that
// takes money it cannot account for is worse than one that admits it is not
// ready, so the behaviour under test is "refuse to invent success", not
// "successfully take a payment".

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// Boots the real page in jsdom with an optional config override. Scripts are
// injected in the same order index.html uses, because that order is itself part
// of what is being tested (currency before app, config before everything).
function loadPage({ config, storage } = {}) {
  const dom = new JSDOM(html, {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      if (config !== undefined) window.GREENCART_CONFIG = config;
      if (storage) {
        Object.entries(storage).forEach(([key, value]) => window.localStorage.setItem(key, value));
      }
      window.requestAnimationFrame = callback => window.setTimeout(callback, 0);
    }
  });
  const { window } = dom;
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error || event.message));
  const inject = file => {
    const script = window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(root, file), 'utf8');
    window.document.body.appendChild(script);
  };
  try {
    ['js/config.js', 'js/currency.js', 'js/products.js', 'js/store.js', 'js/payments.js', 'js/app.js'].forEach(inject);
    // Top-level `const` bindings never reach `window`, so hand the tests the two
    // handles they need rather than weakening the page's scope.
    const bridge = window.document.createElement('script');
    bridge.textContent = 'window.AppStore = AppStore;';
    window.document.body.appendChild(bridge);
  } catch (error) {
    errors.push(error);
  }
  return { dom, window, document: window.document, errors, close: () => dom.window.close() };
}

// Put the first product in the bag through the real button, so the checkout
// button's enabled state is updated by the app rather than assumed by the test.
function addFirstProduct(window, document) {
  document.querySelector('[data-action="add-cart"]').click();
  if (!window.AppStore.cart.length) throw new Error('add-to-bag did not add anything');
}

// Fill the checkout and press the button, returning once the handler has had a
// chance to run (submitCheckout is async).
async function pressPlaceOrder(window, document) {
  document.getElementById('checkoutName').value = 'Ada Customer';
  document.getElementById('checkoutAddress').value = '1 Main Street';
  document.getElementById('checkoutCity').value = 'Port Harcourt';
  document.getElementById('checkoutEmail').value = 'ada@example.com';
  document.getElementById('checkoutForm').dispatchEvent(
    new window.Event('submit', { bubbles: true, cancelable: true })
  );
  await new Promise(resolve => window.setTimeout(resolve, 0));
}

test('the committed config ships no payment keys and no secrets', () => {
  const source = fs.readFileSync(path.join(root, 'js/config.js'), 'utf8');
  // A public key is safe to ship; a SECRET key never is. Guard the second.
  assert.doesNotMatch(source, /sk_(live|test)_[A-Za-z0-9]/,
    'a Paystack secret key must never be committed to this repository');
  const page = loadPage();
  try {
    const payments = page.window.GreenCartPayments;
    assert.equal(payments.isConfigured(), false, 'payments must ship disabled');
    assert.equal(payments.status().reason, 'not-configured');
    // Exactly one thing is missing: the owner-supplied public key. The gateway
    // endpoints ship in this repository, so they are already present.
    assert.deepEqual(payments.status().missing, ['publicKey']);
  } finally {
    page.close();
  }
});

test('with payments off, checkout refuses and no order is invented', async () => {
  const page = loadPage();
  try {
    const { window, document } = page;
    addFirstProduct(window, document);
    document.getElementById('checkoutTriggerBtn').click();

    // The disclosure must say so plainly before the shopper tries.
    const disclosure = document.getElementById('checkoutDisclosure');
    assert.match(disclosure.textContent, /not switched on yet/i);
    assert.ok(disclosure.classList.contains('checkout-disclosure-blocked'));

    // The refusal must happen BEFORE the payment provider is even consulted.
    // Counting orders alone is too weak: with the guard removed, charge() still
    // returns "failed", so nothing changes and the test would pass anyway.
    let providerContacted = false;
    window.GreenCartPayments.charge = () => { providerContacted = true; return Promise.resolve({ status: 'failed' }); };

    await pressPlaceOrder(window, document);

    assert.equal(providerContacted, false, 'the checkout must refuse before starting a payment');
    assert.equal(window.AppStore.orders.length, 0, 'no order may be created while payments are off');
    assert.equal(document.getElementById('orderSuccessScreen').hidden, true, 'no success screen');
    assert.equal(window.AppStore.cart.length, 1, 'the bag is kept so the shopper loses nothing');
  } finally {
    page.close();
  }
});

test('a pasted secret key is refused rather than shipped', () => {
  const page = loadPage({
    config: { payments: { publicKey: 'sk_live_abc123', verifyUrl: 'https://example.com/verify' } }
  });
  try {
    const status = page.window.GreenCartPayments.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'secret-key-in-config');
  } finally {
    page.close();
  }
});

test('an endpoint that is neither HTTPS nor same-origin leaves payments off', () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'http://example.com/verify' } }
  });
  try {
    const status = page.window.GreenCartPayments.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'endpoint-not-usable');
  } finally {
    page.close();
  }
});

test('the shipped gateway endpoints are same-origin paths, which is allowed', () => {
  const page = loadPage({ config: { payments: { publicKey: 'pk_test_abc123' } } });
  try {
    const status = page.window.GreenCartPayments.status();
    assert.equal(status.enabled, true, 'a same-origin /api path needs no absolute URL');
    assert.equal(status.reason, 'ready');
  } finally {
    page.close();
  }
});

test('a public key alone is not enough if the endpoints are removed', () => {
  // This is the guard against "the browser says it worked": without a server to
  // price and confirm the charge, a public key must not enable checkout.
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', initializeUrl: '', verifyUrl: '' } }
  });
  try {
    const status = page.window.GreenCartPayments.status();
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'not-configured');
    assert.deepEqual(status.missing, ['initializeUrl', 'verifyUrl']);
  } finally {
    page.close();
  }
});

test('a verified charge records a paid order against a server-confirmed reference', async () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'https://example.test/verify' } }
  });
  try {
    const { window, document } = page;

    // Stand in for Paystack's popup and for the owner's verification endpoint.
    window.PaystackPop = {
      setup(options) {
        return {
          openIframe() {
            // The popup reports success; the browser is NOT believed yet.
            Promise.resolve().then(() => options.callback({ reference: 'PSK-123' }));
          }
        };
      }
    };
    let askedAbout = '';
    window.fetch = async (url, init) => {
      if (String(url).includes('initialize')) {
        return { ok: true, json: async () => ({ success: true, reference: 'PSK-123', amount: 40305798, currency: 'NGN' }) };
      }
      askedAbout = JSON.parse(init.body).reference;
      return { ok: true, json: async () => ({ success: true, reference: 'PSK-123', amount: 40305798 }) };
    };

    addFirstProduct(window, document);
    document.getElementById('checkoutTriggerBtn').click();
    await pressPlaceOrder(window, document);

    assert.equal(askedAbout, 'PSK-123', 'the browser asks the server about the real reference');
    assert.equal(window.AppStore.orders.length, 1);
    const order = window.AppStore.orders[0];
    assert.equal(order.payment.status, 'paid');
    assert.equal(order.payment.reference, 'PSK-123');
    assert.equal(order.payment.provider, 'paystack');
    assert.match(order.reference, /^GC-\d{4}-/);
  } finally {
    page.close();
  }
});

test('a charge the server refuses to confirm is recorded as unverified, not paid', async () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'https://example.test/verify' } }
  });
  try {
    const { window, document } = page;
    window.PaystackPop = {
      setup(options) {
        return { openIframe() { Promise.resolve().then(() => options.callback({ reference: 'PSK-999' })); } };
      }
    };
    // The popup claimed success; the server says no. The server wins.
    window.fetch = async url => String(url).includes('initialize')
      ? { ok: true, json: async () => ({ success: true, reference: 'PSK-999', amount: 40305798, currency: 'NGN' }) }
      : { ok: true, json: async () => ({ success: false, message: 'Not a real charge.' }) };

    addFirstProduct(window, document);
    document.getElementById('checkoutTriggerBtn').click();
    await pressPlaceOrder(window, document);

    assert.equal(window.AppStore.orders.length, 1, 'the order is kept so a real payment is not lost');
    assert.equal(window.AppStore.orders[0].payment.status, 'unverified');
    assert.notEqual(window.AppStore.orders[0].payment.status, 'paid');
    assert.match(document.getElementById('orderSuccessSummary').textContent, /still being confirmed/i);
    assert.doesNotMatch(document.getElementById('orderSuccessSummary').textContent, /confirmed and your order has been received/i);
  } finally {
    page.close();
  }
});

test('an unreachable verification server does not become a paid order', async () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'https://example.test/verify' } }
  });
  try {
    const { window, document } = page;
    window.PaystackPop = {
      setup(options) {
        return { openIframe() { Promise.resolve().then(() => options.callback({ reference: 'PSK-500' })); } };
      }
    };
    window.fetch = async url => {
      if (String(url).includes('initialize')) {
        return { ok: true, json: async () => ({ success: true, reference: 'PSK-500', amount: 40305798, currency: 'NGN' }) };
      }
      throw new Error('network down');
    };

    addFirstProduct(window, document);
    document.getElementById('checkoutTriggerBtn').click();
    await pressPlaceOrder(window, document);

    assert.equal(window.AppStore.orders[0].payment.status, 'unverified');
  } finally {
    page.close();
  }
});

test('closing the payment window cancels without charging or ordering', async () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'https://example.test/verify' } }
  });
  try {
    const { window, document } = page;
    window.PaystackPop = {
      setup(options) { return { openIframe() { Promise.resolve().then(() => options.onClose()); } }; }
    };
    window.fetch = async () => { throw new Error('must not be called'); };

    addFirstProduct(window, document);
    document.getElementById('checkoutTriggerBtn').click();
    await pressPlaceOrder(window, document);

    assert.equal(window.AppStore.orders.length, 0);
    assert.equal(window.AppStore.cart.length, 1);
  } finally {
    page.close();
  }
});

test('an empty bag or bad email never reaches the payment provider', async () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'https://example.test/verify' } }
  });
  try {
    const { window, document } = page;
    let providerAsked = false;
    window.PaystackPop = { setup() { providerAsked = true; return { openIframe() { } }; } };
    window.fetch = async () => { providerAsked = true; return { ok: true, json: async () => ({ success: true }) }; };

    // Empty bag.
    document.getElementById('checkoutTriggerBtn').click();
    await pressPlaceOrder(window, document);
    assert.equal(providerAsked, false, 'no charge attempt on an empty bag');

    // Bad email, now with something in the bag.
    addFirstProduct(window, document);
    document.getElementById('checkoutEmail').value = 'not-an-email';
    document.getElementById('checkoutForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(resolve => window.setTimeout(resolve, 0));
    assert.equal(providerAsked, false, 'no charge attempt without a valid email');
    assert.equal(window.AppStore.orders.length, 0);
  } finally {
    page.close();
  }
});

test('a succeeded charge that cannot be recorded keeps its reference for the shopper', async () => {
  const page = loadPage({
    config: { payments: { publicKey: 'pk_test_abc123', verifyUrl: 'https://example.test/verify' } }
  });
  try {
    const { window, document } = page;
    window.PaystackPop = {
      setup(options) {
        return { openIframe() { Promise.resolve().then(() => options.callback({ reference: 'PSK-STRANDED' })); } };
      }
    };
    window.fetch = async url => String(url).includes('initialize')
      ? { ok: true, json: async () => ({ success: true, reference: 'PSK-STRANDED', amount: 40305798, currency: 'NGN' }) }
      : { ok: true, json: async () => ({ success: true, reference: 'PSK-STRANDED' }) };

    addFirstProduct(window, document);
    // Make order creation throw AFTER the charge, the worst ordering problem.
    window.AppStore.placeOrder = () => { throw new Error('storage full'); };

    document.getElementById('checkoutTriggerBtn').click();
    await pressPlaceOrder(window, document);

    assert.equal(document.getElementById('orderSuccessScreen').hidden, false);
    assert.match(document.getElementById('orderSuccessSummary').textContent, /PSK-STRANDED/);
    assert.match(document.getElementById('orderSuccessSummary').textContent, /send this reference to the store|contact/i);
    // The reference survives a reload so the store can reconcile it later.
    const stranded = JSON.parse(window.localStorage.getItem('greencart_stranded_payments_v1'));
    assert.equal(stranded[0].reference, 'PSK-STRANDED');
  } finally {
    page.close();
  }
});
