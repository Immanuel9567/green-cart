// POST /api/admin-login
//
// Exchanges the store owner's password for a short-lived signed token.
//
// WHY THIS EXISTS
// The admin area can read every order and change every price, so it cannot be
// reachable by pressing a button. This is the door. It is deliberately the only
// place a password is accepted, and it accepts it once per session rather than on
// every request.

const { readJson, send, rejectMethod } = require('./_lib/http');
const session = require('./_lib/session');

// A crude throttle: ten wrong passwords per address per ten minutes. It is not a
// substitute for a strong password, and it is described here honestly rather than
// presented as real rate limiting. It exists to stop a script guessing forever,
// which is what an unprotected login endpoint invites.
const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function clientAddress(request) {
  const forwarded = String((request.headers && request.headers['x-forwarded-for']) || '');
  return forwarded.split(',')[0].trim() || String((request.socket && request.socket.remoteAddress) || 'unknown');
}

function recordFailure(address) {
  const now = Date.now();
  const entry = attempts.get(address) || { count: 0, first: now };
  if (now - entry.first > WINDOW_MS) {
    attempts.set(address, { count: 1, first: now });
    return;
  }
  entry.count += 1;
  attempts.set(address, entry);
}

function isThrottled(address) {
  const entry = attempts.get(address);
  if (!entry) return false;
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(address);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

// Exported for the tests so a run does not inherit another run's counters.
function resetThrottle() {
  attempts.clear();
}

module.exports = async function handler(request, response) {
  if (request.method !== 'POST') return rejectMethod(response, 'POST');

  if (!session.isConfigured()) {
    // Saying exactly what is missing is safe: it is a server setting, not a
    // secret, and the alternative is an owner staring at "unauthorised" forever.
    return send(response, 503, {
      success: false,
      message: 'The admin area is not configured on this deployment. Set ADMIN_PASSWORD to enable it.'
    });
  }

  const address = clientAddress(request);
  if (isThrottled(address)) {
    return send(response, 429, {
      success: false,
      message: 'Too many attempts. Wait ten minutes before trying again.'
    });
  }

  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    return send(response, 400, { success: false, message: 'The request body could not be read.' });
  }

  if (!session.checkPassword(body.password)) {
    recordFailure(address);
    // The same message for "wrong password" and "no password sent", so the
    // response does not confirm which half was right.
    return send(response, 401, { success: false, message: 'That password is not correct.' });
  }

  attempts.delete(address);
  const { token, expiresAt } = session.issueToken();
  // HttpOnly: the token is not readable by JavaScript, so a cross-site scripting
  // bug elsewhere on the site cannot steal the admin session. SameSite=Strict:
  // the cookie is not sent on a request started by another site, which is what
  // stops a third-party page from acting as the owner.
  response.setHeader(
    'Set-Cookie',
    `greencart_admin=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expiresAt - Math.floor(Date.now() / 1000)}${process.env.VERCEL ? '; Secure' : ''}`
  );
  return send(response, 200, { success: true, token, expiresAt });
};

module.exports.resetThrottle = resetThrottle;
