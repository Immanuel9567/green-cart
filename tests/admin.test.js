// Tests for the browser's admin access flow and the shared-store sync module.
//
// These boot the real page in jsdom and stub only the network, so what is tested
// is the behaviour a person sees: the door is shut until a password is accepted,
// the connection state is stated honestly, and a lost version race does not
// silently discard an edit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function loadPage(fetchImpl) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  virtualConsole.on('error', (...args) => errors.push(args.join(' ')));
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://127.0.0.1/?admin=1',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = () => null;
      // Only the network is stubbed. Everything else is the real page.
      window.fetch = fetchImpl || (async () => { throw new Error('no network in this test'); });
    }
  });
  const { window } = dom;
  const inject = file => {
    const script = window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(root, file), 'utf8');
    window.document.body.appendChild(script);
  };
  ['js/config.js', 'js/currency.js', 'js/search.js', 'js/products.js', 'js/store.js',
    'js/sync.js', 'js/payments.js', 'js/app.js'].forEach(inject);
  const bridge = window.document.createElement('script');
  bridge.textContent = 'window.AppStore = AppStore; window.renderAdminAccess = renderAdminAccess; window.handleAdminLogin = handleAdminLogin; window.syncFromServer = syncFromServer; window.renderAdminConnection = renderAdminConnection; window.renderAdminOrders = renderAdminOrders; window.loadServerOrders = loadServerOrders; window.syncState = () => ({ serverOrders, serverOrdersState });';
  window.document.body.appendChild(bridge);
  return { window, document: window.document, errors, close: () => window.close() };
}

// A fetch stub that answers like the real endpoints.
function stubServer(handlers) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
    const handler = handlers.find(entry => String(url).includes(entry.match));
    const result = handler ? handler.reply(options) : { status: 404, data: { success: false } };
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.data
    };
  };
  impl.calls = calls;
  return impl;
}

test('the admin area is shut until a password is accepted', () => {
  const page = loadPage();
  try {
    const { document } = page;
    assert.equal(document.getElementById('adminGate').hidden, false, 'the gate is shown');
    assert.equal(document.getElementById('adminPanels').hidden, true, 'the panels are not');
    assert.equal(document.getElementById('adminSignOutBtn').hidden, true, 'and there is nothing to sign out of');
  } finally {
    page.close();
  }
});

test('the connection state is stated as local when nothing is shared', () => {
  const page = loadPage();
  try {
    const label = page.document.getElementById('adminConnectionLabel');
    assert.equal(label.textContent, 'Local preview', 'an unconnected shop says so plainly');
    assert.ok(page.document.getElementById('adminConnectionNote').classList.contains('is-local'));
  } finally {
    page.close();
  }
});

test('a rejected password keeps the door shut and says why', async () => {
  const fetchImpl = stubServer([
    { match: '/api/admin-login', reply: () => ({ status: 401, data: { success: false, message: 'That password is not correct.' } }) }
  ]);
  const page = loadPage(fetchImpl);
  try {
    const { window, document } = page;
    document.getElementById('adminPassword').value = 'wrong';
    await window.handleAdminLogin();
    assert.equal(document.getElementById('adminGate').hidden, false, 'the gate stays');
    assert.equal(document.getElementById('adminPanels').hidden, true, 'the panels stay hidden');
    assert.equal(document.getElementById('adminLoginError').hidden, false, 'and the failure is shown');
    assert.match(document.getElementById('adminLoginError').textContent, /not correct/i);
  } finally {
    page.close();
  }
});

test('a correct password opens the door', async () => {
  const fetchImpl = stubServer([
    { match: '/api/admin-login', reply: () => ({ status: 200, data: { success: true, token: 'good-token' } }) },
    { match: '/api/admin/state', reply: () => ({ status: 200, data: { success: true, doc: null, version: 0 } }) }
  ]);
  const page = loadPage(fetchImpl);
  try {
    const { window, document } = page;
    document.getElementById('adminPassword').value = 'right';
    await window.handleAdminLogin();
    assert.equal(document.getElementById('adminGate').hidden, true, 'the gate closes');
    assert.equal(document.getElementById('adminPanels').hidden, false, 'the panels open');
    assert.equal(document.getElementById('adminSignOutBtn').hidden, false, 'and sign-out appears');
    // The password must not be left in the field.
    assert.equal(document.getElementById('adminPassword').value, '');
  } finally {
    page.close();
  }
});

test('signing out closes the door again', async () => {
  const fetchImpl = stubServer([
    { match: '/api/admin-login', reply: () => ({ status: 200, data: { success: true, token: 'good-token' } }) },
    { match: '/api/admin/state', reply: () => ({ status: 200, data: { success: true, doc: null, version: 0 } }) }
  ]);
  const page = loadPage(fetchImpl);
  try {
    const { window, document } = page;
    document.getElementById('adminPassword').value = 'right';
    await window.handleAdminLogin();
    document.getElementById('adminSignOutBtn').click();
    assert.equal(document.getElementById('adminGate').hidden, false, 'the gate returns');
    assert.equal(document.getElementById('adminPanels').hidden, true);
    assert.equal(window.GreenCartSync.isSignedIn(), false);
  } finally {
    page.close();
  }
});

// --------------------------------------------------------------- the sync layer

test('a lost version race is reported, not swallowed', async () => {
  // Two devices: this one read version 3, another already wrote version 4.
  const page = loadPage();
  try {
    const { window } = page;
    window.GreenCartSync.signIn = async () => ({ ok: true, token: 't' });
    await window.GreenCartSync.signIn();
    window.fetch = stubServer([
      { match: '/api/admin/state', reply: () => ({ status: 409, data: { success: false, version: 4, message: 'Someone else changed the shop on another device.' } }) }
    ]);
    const result = await window.GreenCartSync.pushState({ products: [] }, 3);
    assert.equal(result.ok, false);
    assert.equal(result.conflict, true, 'the conflict is flagged');
    assert.equal(result.version, 4, 'and the current version is reported');
    assert.match(result.message, /another device/i);
  } finally {
    page.close();
  }
});

test('a network failure is not reported as a server error', async () => {
  const page = loadPage();
  try {
    const { window } = page;
    window.GreenCartSync.signIn = async () => ({ ok: true, token: 't' });
    await window.GreenCartSync.signIn();
    window.fetch = async () => { throw new Error('offline'); };
    const result = await window.GreenCartSync.pushState({ products: [] }, 1);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'network', 'an offline edit is a different thing from a rejected one');
    assert.match(result.message, /saved on this device/i, 'and the person is told their work is safe locally');
  } finally {
    page.close();
  }
});

test('an expired session is recognised and the token dropped', async () => {
  const page = loadPage();
  try {
    const { window } = page;
    window.GreenCartSync.signIn = async () => ({ ok: true, token: 't' });
    await window.GreenCartSync.signIn();
    window.fetch = stubServer([{ match: '/api/admin/orders', reply: () => ({ status: 401, data: { success: false } }) }]);
    const result = await window.GreenCartSync.fetchOrders();
    assert.equal(result.reason, 'unauthorised');
    assert.equal(window.GreenCartSync.isSignedIn(), false, 'the dead token is discarded');
  } finally {
    page.close();
  }
});

test('a pay-on-delivery order that the server did not store says so', async () => {
  const page = loadPage();
  try {
    const { window } = page;
    // The database is not configured: the endpoint answers 503.
    window.fetch = stubServer([
      { match: '/api/orders', reply: () => ({ status: 503, data: { success: false, persisted: false, message: 'The shop is not connected to its shared database yet.' } }) }
    ]);
    const result = await window.GreenCartSync.recordOrder({
      reference: 'GC-TEST-1',
      items: [{ id: 'aura-01', quantity: 1 }],
      customer: { name: 'A', address: 'B', city: 'C', email: 'a@b.co' }
    });
    assert.equal(result.ok, false);
    assert.equal(result.persisted, false, 'never claim an order was stored when it was not');
    assert.match(result.message, /not connected/i);
  } finally {
    page.close();
  }
});

test('the shared document is adopted without touching the local bag', async () => {
  const page = loadPage();
  try {
    const { window } = page;
    window.AppStore.addToCart('aura-01');
    const before = window.AppStore.getCartCount();
    assert.equal(before, 1, 'the bag has something in it');
    window.AppStore.adoptSharedState({
      products: window.AppStore.products.map(product => ({ ...product, price: 123 })),
      orders: [],
      promotions: []
    });
    assert.equal(window.AppStore.getCartCount(), 1, 'a sync must not empty the shopper\'s bag');
    assert.equal(window.AppStore.products.find(p => p.id === 'aura-01').price, 123, 'but the catalogue is adopted');
  } finally {
    page.close();
  }
});
