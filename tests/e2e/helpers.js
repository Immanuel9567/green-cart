// Shared helpers for the browser tests.
//
// THE ADMIN AREA HAS A DOOR NOW
// Every admin spec used to click straight into the panel because it was a local
// demo with nothing to protect. It now reads real orders from the store database,
// so it asks for a password. These helpers open it the way an owner would, so the
// specs keep testing the panel rather than testing the gate over and over.

// The password the tests sign in with. The app is served statically by these
// specs, so there is no server to accept it: `stubAdminSession` fakes the login
// response and the order list, which is why these specs stay fast and offline.
const TEST_PASSWORD = 'test-password';

// Make the page believe an owner is signed in, without a server.
async function stubAdminSession(page) {
  await page.addInitScript(() => {
    // The login endpoint answers success; the state endpoint says nothing is
    // shared yet; the orders endpoint says the database is not configured. All
    // three are honest answers for a statically served page.
    const json = (status, data) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data
    });
    window.fetch = async url => {
      const target = String(url);
      if (target.includes('/api/admin-login')) return json(200, { success: true, token: 'e2e-token' });
      if (target.includes('/api/admin/orders')) return json(503, { success: false, message: 'The shared database is not configured.' });
      if (target.includes('/api/admin/state')) return json(503, { success: false, message: 'The shared database is not configured.' });
      if (target.includes('/api/orders')) return json(503, { success: false, persisted: false, message: 'Not configured.' });
      return json(404, { success: false });
    };
  });
}

// Open the admin panel as a signed-in owner.
async function openAdmin(page, options = {}) {
  await stubAdminSession(page);
  await page.goto(options.path || '/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  // Wait until one of the two states is actually on screen. A combined locator
  // with .first() does not do this: it locks onto the first matching element in
  // the DOM (the hidden gate) and waits for that one forever.
  await page.waitForFunction(() => {
    const panels = document.getElementById('adminPanels');
    const gate = document.getElementById('adminGate');
    return (panels && !panels.hidden) || (gate && !gate.hidden);
  }, null, { timeout: 15000 });
  // Use the DOM's hidden flag, not a visibility probe: during the opening
  // transition `isVisible()` can answer false for a panel that is already shown.
  const signedIn = await page.evaluate(() => !document.getElementById('adminPanels').hidden);
  if (signedIn) return;
  await page.locator('#adminPassword').fill(TEST_PASSWORD);
  await page.locator('#adminLoginBtn').click();
  await page.locator('#adminPanels').waitFor({ state: 'visible', timeout: 20000 });
}

module.exports = { openAdmin, stubAdminSession, TEST_PASSWORD };
