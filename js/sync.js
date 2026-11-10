// The browser's connection to the shared store.
//
// WHY THIS FILE EXISTS
// The shop has always worked from localStorage, and that was fine as a demo but
// wrong as a shop: a customer's order lived only in their own browser, so the
// owner never saw it, and the admin panel was always empty on a different device.
// This module is what makes the data SHARED without throwing away the thing that
// made the shop pleasant — it still opens instantly, even offline.
//
// THE MODEL: LOCAL FIRST, THEN SYNCED
//   1. The shop always renders from localStorage. No spinner, no blank page, and
//      it works with the network down.
//   2. When the owner signs in, the shared document is fetched and, if it is
//      newer than what this device holds, it replaces the local copy.
//   3. When the owner changes something, the change is saved locally AND pushed
//      to the server with the version it was based on.
//   4. If the push loses a version race, the local change is NOT thrown away
//      silently: the user is told the shop changed elsewhere and is offered a
//      reload.
//
// WHY ORDERS ARE SEPARATE
// An order is not part of the catalogue document. It is its own record with its
// own table (db/schema.sql), because it must survive a catalogue rewrite and must
// never have its money edited.

(function () {
  const CONFIG = window.GREENCART_CONFIG || {};
  const SYNC = CONFIG.sync || {};
  const STATE_URL = String(SYNC.stateUrl || '/api/admin/state');
  const ORDERS_URL = String(SYNC.ordersUrl || '/api/admin/orders');
  const LOGIN_URL = String(SYNC.loginUrl || '/api/admin-login');
  const PUBLIC_ORDERS_URL = String(SYNC.publicOrdersUrl || '/api/orders');

  let token = null;
  let lastVersion = 0;
  let available = null; // null = not yet known

  // ------------------------------------------------------------------ helpers

  async function request(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        credentials: 'same-origin',
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (_) {
      // A network failure is not a server error, and must not be reported as one.
      return { ok: false, status: 0, data: null, network: true };
    }

    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      data = null;
    }
    return { ok: response.ok, status: response.status, data };
  }

  // Has the server told us whether sharing is switched on? Kept so the UI can be
  // honest rather than showing a sync button that silently does nothing.
  function isAvailable() {
    return available === true;
  }

  function isSignedIn() {
    return Boolean(token);
  }

  function version() {
    return lastVersion;
  }

  function signOut() {
    token = null;
    lastVersion = 0;
    available = null;
  }

  // Adopt a token that survived a refresh in this tab, so the owner is not asked
  // for the password again on every reload. The token is still verified by the
  // server on the first request; restoring it here only means the browser stops
  // forgetting a session that is still valid.
  function restoreToken(existing) {
    token = String(existing || '') || null;
    return isSignedIn();
  }

  // ------------------------------------------------------------------- sign in

  async function signIn(password) {
    const result = await request(LOGIN_URL, { method: 'POST', body: { password } });
    if (result.network) return { ok: false, reason: 'network', message: 'Could not reach the server.' };
    if (!result.ok) {
      return {
        ok: false,
        reason: result.status === 503 ? 'not-configured' : 'rejected',
        message: (result.data && result.data.message) || 'That password is not correct.'
      };
    }
    token = result.data.token;
    available = true;
    return { ok: true, token };
  }

  // ---------------------------------------------------------------- the document

  // Fetch the shared document. Returns:
  //   { ok: true, doc, version }        — the server has a document
  //   { ok: true, doc: null, version: 0 } — nothing saved yet (a new shop)
  //   { ok: false, reason, message }    — could not read it
  async function pullState() {
    const result = await request(STATE_URL);
    if (result.network) return { ok: false, reason: 'network', message: 'Could not reach the server.' };
    if (result.status === 401) { token = null; return { ok: false, reason: 'unauthorised', message: 'Your session has expired. Sign in again.' }; }
    if (result.status === 503) {
      available = false;
      return { ok: false, reason: 'unavailable', message: (result.data && result.data.message) || 'Sharing is not configured.' };
    }
    if (!result.ok || !result.data || !result.data.success) {
      return { ok: false, reason: 'failed', message: (result.data && result.data.message) || 'The shop could not be read from the server.' };
    }
    available = true;
    lastVersion = Number(result.data.version) || 0;
    return { ok: true, doc: result.data.doc, version: lastVersion };
  }

  // Push the document. `expectedVersion` is the version this edit was based on.
  // Returns the same shape as pullState, plus { conflict: true } on a lost race.
  async function pushState(doc, expectedVersion) {
    const result = await request(STATE_URL, {
      method: 'PUT',
      body: { doc, version: expectedVersion === undefined ? lastVersion : expectedVersion }
    });
    if (result.network) return { ok: false, reason: 'network', message: 'Could not reach the server. The change is saved on this device.' };
    if (result.status === 401) { token = null; return { ok: false, reason: 'unauthorised', message: 'Your session has expired. Sign in again.' }; }
    if (result.status === 503) {
      available = false;
      return { ok: false, reason: 'unavailable', message: (result.data && result.data.message) || 'Sharing is not configured.' };
    }
    if (result.status === 409) {
      // The important case: another device wrote first. Say so; do not clobber.
      lastVersion = Number(result.data && result.data.version) || lastVersion;
      return {
        ok: false,
        conflict: true,
        reason: 'conflict',
        version: lastVersion,
        message: (result.data && result.data.message) || 'The shop changed on another device. Reload before saving.'
      };
    }
    if (!result.ok || !result.data || !result.data.success) {
      return { ok: false, reason: 'failed', message: (result.data && result.data.message) || 'The change could not be saved to the server.' };
    }
    lastVersion = Number(result.data.version) || lastVersion;
    return { ok: true, version: lastVersion };
  }

  // -------------------------------------------------------------------- orders

  async function fetchOrders(limit) {
    const url = limit ? `${ORDERS_URL}?limit=${encodeURIComponent(limit)}` : ORDERS_URL;
    const result = await request(url);
    if (result.network) return { ok: false, reason: 'network', message: 'Could not reach the server.' };
    if (result.status === 401) { token = null; return { ok: false, reason: 'unauthorised', message: 'Your session has expired. Sign in again.' }; }
    if (result.status === 503) {
      available = false;
      return { ok: false, reason: 'unavailable', message: (result.data && result.data.message) || 'Orders are not being stored yet.' };
    }
    if (!result.ok || !result.data || !result.data.success) {
      return { ok: false, reason: 'failed', message: (result.data && result.data.message) || 'Orders could not be read.' };
    }
    return { ok: true, orders: result.data.orders || [], totals: result.data.totals || null };
  }

  async function advanceOrder(reference, status) {
    const result = await request(ORDERS_URL, { method: 'PATCH', body: { reference, status } });
    if (result.network) return { ok: false, reason: 'network', message: 'Could not reach the server.' };
    if (result.status === 401) { token = null; return { ok: false, reason: 'unauthorised', message: 'Your session has expired. Sign in again.' }; }
    if (!result.ok) {
      return { ok: false, reason: 'rejected', message: (result.data && result.data.message) || 'That change was refused.' };
    }
    return { ok: true, status: result.data.status };
  }

  // Record a pay-on-delivery order centrally. This is the call that makes a
  // customer's order visible to the owner.
  //
  // Returns { ok, persisted, reference, message }. `persisted: false` means the
  // order exists only on this device, and the caller MUST tell the customer.
  async function recordOrder(order) {
    const result = await request(PUBLIC_ORDERS_URL, {
      method: 'POST',
      body: {
        reference: order.reference,
        method: 'pay-on-delivery',
        lines: (order.items || []).map(item => ({ id: item.id, quantity: item.quantity })),
        promo: order.promotionCode || '',
        customer: {
          name: order.customer && order.customer.name,
          address: order.customer && order.customer.address,
          city: order.customer && order.customer.city,
          email: order.customer && order.customer.email
        }
      }
    });

    if (result.network) {
      return { ok: false, persisted: false, reference: order.reference, message: 'The shop could not be reached, so this order is saved on this device only.' };
    }
    if (result.status === 503) {
      available = false;
      return { ok: false, persisted: false, reference: order.reference, message: (result.data && result.data.message) || 'The shop is not connected yet, so this order is saved on this device only.' };
    }
    if (!result.ok) {
      return {
        ok: false,
        persisted: false,
        reference: order.reference,
        message: (result.data && result.data.message) || 'The shop could not record this order, so it is saved on this device only.'
      };
    }
    return { ok: true, persisted: Boolean(result.data && result.data.persisted), reference: order.reference };
  }

  window.GreenCartSync = {
    signIn,
    signOut,
    restoreToken,
    isSignedIn,
    isAvailable,
    version,
    pullState,
    pushState,
    fetchOrders,
    advanceOrder,
    recordOrder,
    urls: { STATE_URL, ORDERS_URL, LOGIN_URL, PUBLIC_ORDERS_URL }
  };
})();
