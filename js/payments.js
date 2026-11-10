// Card payments for GreenCart, via Paystack.
//
// THE RULE THIS FILE EXISTS TO ENFORCE
// A browser can lie. It can call any function, post any JSON and set any flag.
// So nothing here is allowed to decide that money moved. The browser's only
// job is to ask the provider to take a payment; the provider tells a SERVER
// whether it worked, and the server tells this file. Until js/config.js holds
// both a public key and a verify URL, the honest answer is "payments are not
// switched on", and that is what this module returns.
//
// What this file deliberately does NOT do:
//  - It does not read, store or transmit card numbers. The provider's own
//    checkout collects them; they never pass through this site.
//  - It does not keep a secret key. There is no secret key in this repository
//    and there must never be one.
//  - It does not mark an order paid because the provider's popup said "success".
//    The callback only proves the popup closed; the server's verification is
//    what counts.

(function () {
  const CONFIG = window.GREENCART_CONFIG || {};
  const PAYMENTS = CONFIG.payments || {};
  const CURRENCY = window.GreenCartCurrency;

  const PUBLIC_KEY = String(PAYMENTS.publicKey || '').trim();
  const VERIFY_URL = String(PAYMENTS.verifyUrl || '').trim();
  const INITIALIZE_URL = String(PAYMENTS.initializeUrl || '').trim();

  // Paystack's public keys start with "pk_". Catching a pasted secret key
  // ("sk_") here is the last line of defence against leaking it to every
  // visitor — the error is loud on purpose.
  function keyLooksSecret(key) {
    return /^sk_/i.test(key);
  }

  // A same-origin path ("/api/verify-payment") is the normal case, because the
  // gateway ships in this repository. An absolute URL must be HTTPS: sending a
  // payment reference over plain HTTP would let it be read in transit.
  function isUsableEndpoint(value) {
    if (!value) return false;
    if (value.startsWith('/')) return true;
    return /^https:\/\//i.test(value);
  }

  // One implementation of "are payments usable", so the UI and the gate can
  // never disagree. They did once: status() reported ready while isConfigured()
  // said no, and the checkout promised a charge it could not take.
  function evaluate() {
    if (keyLooksSecret(PUBLIC_KEY)) {
      return { enabled: false, reason: 'secret-key-in-config' };
    }
    const missing = [];
    if (!PUBLIC_KEY) missing.push('publicKey');
    if (!INITIALIZE_URL) missing.push('initializeUrl');
    if (!VERIFY_URL) missing.push('verifyUrl');
    if (missing.length) return { enabled: false, reason: 'not-configured', missing };
    if (!isUsableEndpoint(INITIALIZE_URL)) return { enabled: false, reason: 'endpoint-not-usable' };
    if (!isUsableEndpoint(VERIFY_URL)) return { enabled: false, reason: 'endpoint-not-usable' };
    return { enabled: true, reason: 'ready' };
  }

  function isConfigured() {
    return evaluate().enabled;
  }

  // Why payments are off, phrased for a human reading the checkout.
  function status() {
    return evaluate();
  }

  function loadProvider() {
    if (window.PaystackPop) return Promise.resolve(window.PaystackPop);
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js.paystack.co/v1/inline.js';
      script.async = true;
      script.onload = () => (window.PaystackPop ? resolve(window.PaystackPop) : reject(new Error('Payment provider did not load.')));
      script.onerror = () => reject(new Error('Could not reach the payment provider. Check your connection and try again.'));
      document.head.appendChild(script);
    });
  }

  // Ask the owner's server what actually happened. A 200 with success:true is
  // the ONLY thing that marks an order paid. Anything else — a network error, a
  // 500, a body we cannot parse, success:false — resolves to a failure that the
  // UI reports as "not confirmed", never as "paid".
  async function verify(reference) {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference })
    });
    if (!response.ok) {
      return { verified: false, reason: 'The verification server returned ' + response.status + '.' };
    }
    let body;
    try {
      body = await response.json();
    } catch (_) {
      return { verified: false, reason: 'The verification server sent a response that could not be read.' };
    }
    if (!body || body.success !== true) {
      return { verified: false, reason: (body && body.message) || 'The payment could not be confirmed.' };
    }
    return { verified: true, reference: body.reference || reference, amount: body.amount };
  }

  // Ask the server to price the bag and start a transaction. The browser sends
  // WHAT it wants to buy; the server decides what that costs. If they disagree,
  // the server's figure is the one charged.
  async function initialize({ lines, promo, email, customer }) {
    const response = await fetch(INITIALIZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines, promo, email, customer })
    });
    let body;
    try {
      body = await response.json();
    } catch (_) {
      return { ok: false, reason: 'The payment server sent a response that could not be read.' };
    }
    if (!response.ok || !body || body.success !== true) {
      return { ok: false, reason: (body && body.message) || `The payment server returned ${response.status}.` };
    }
    return { ok: true, data: body };
  }

  // Pay for a bag.
  //
  // Resolves to one of:
  //   { status: 'paid',       reference, amount }  server confirmed the charge
  //   { status: 'abandoned' }                      shopper closed the popup
  //   { status: 'unverified', reference, reason }  charged, but not confirmed
  //   { status: 'failed',     reason }             never charged
  //
  // 'unverified' is its own outcome on purpose. Money may have moved, so it must
  // not be reported as a failure the shopper can simply retry, and it must not be
  // reported as success either.
  async function charge({ lines, promo, email, customer }) {
    if (!isConfigured()) {
      return { status: 'failed', reason: 'payments-disabled' };
    }

    // Step 1: the server prices the order. Nothing is charged yet.
    const started = await initialize({ lines, promo, email, customer });
    if (!started.ok) {
      return { status: 'failed', reason: started.reason };
    }
    const { reference, amount, currency } = started.data;

    // Step 2: hand that server-issued reference and amount to the provider. The
    // browser cannot change either one; they came from the server.
    let PaystackPop;
    try {
      PaystackPop = await loadProvider();
    } catch (error) {
      return { status: 'failed', reason: error.message };
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (outcome) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      try {
        const handler = PaystackPop.setup({
          key: PUBLIC_KEY,
          email,
          amount,
          currency: currency || 'NGN',
          reference,
          metadata: { reference, store: 'GreenCart' },
          onClose: () => settle({ status: 'abandoned' }),
          callback: (response) => {
            // Step 3: the popup saying "success" proves nothing. Ask the server.
            verify((response && response.reference) || reference)
              .then((result) => {
                if (result.verified) {
                  settle({ status: 'paid', reference: result.reference || reference, amount });
                } else {
                  settle({ status: 'unverified', reference: reference, reason: result.reason });
                }
              })
              .catch(() => settle({
                status: 'unverified',
                reference: reference,
                reason: 'Could not reach the verification server.'
              }));
          }
        });
        handler.openIframe();
      } catch (error) {
        settle({ status: 'failed', reason: error.message || 'The payment window could not open.' });
      }
    });
  }

  window.GreenCartPayments = {
    isConfigured,
    initialize,
    status,
    charge,
    verify
  };
})();
