// Admin sessions.
//
// WHAT THIS IS
// The owner needs to read orders and edit the catalogue; a shopper must not. That
// means the admin endpoints need to know who is calling.
//
// WHAT THIS IS NOT
// There are no customer accounts, and this does not add any. It is a single
// store-owner password held in an environment variable, exchanged for a signed,
// expiring token. That is the honest amount of authentication for a one-person
// shop, and it is described plainly so nobody mistakes it for a user system.
//
// WHY A SIGNED TOKEN AND NOT A PASSWORD ON EVERY REQUEST
// Sending the password on every request means it is in every request log and
// every browser devtools network panel. The password is exchanged once, over
// HTTPS, for a token that expires and that can be revoked by changing the
// password.
//
// WHICH SECRET SIGNS THE TOKEN
// ADMIN_SESSION_SECRET if set. Otherwise it is derived from ADMIN_PASSWORD, so a
// deployment that only sets a password still works — but changing the password
// then invalidates every session, which is the desired behaviour anyway.

const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 60 * 60 * 12; // 12 hours

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function adminPassword() {
  return readEnv('ADMIN_PASSWORD');
}

function signingSecret() {
  const explicit = readEnv('ADMIN_SESSION_SECRET');
  if (explicit) return explicit;
  const password = adminPassword();
  // A derived secret is stable while the password is, and changing the password
  // invalidates outstanding sessions. That is the behaviour we want.
  return password ? crypto.createHash('sha256').update(`greencart-session:${password}`).digest('hex') : '';
}

// Is the admin area usable at all? Without a password, it is not — and every
// admin endpoint must say so rather than silently allowing access.
function isConfigured() {
  return Boolean(adminPassword() && signingSecret());
}

function base64url(input) {
  return Buffer.from(input, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(input) {
  const padded = String(input).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(payloadText, secret) {
  return base64url(crypto.createHmac('sha256', secret).update(payloadText).digest('base64'));
}

// Compare two strings without leaking their difference through timing.
function safeEqual(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Check a submitted password. Compared in constant time so the response time
// does not reveal how much of the password was correct.
function checkPassword(submitted) {
  const expected = adminPassword();
  if (!expected) return false;
  return safeEqual(String(submitted || ''), expected);
}

function issueToken(ttlSeconds = DEFAULT_TTL_SECONDS) {
  const secret = signingSecret();
  if (!secret) throw new Error('Admin sessions are not configured.');
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = { sub: 'owner', iat: issuedAt, exp: issuedAt + ttlSeconds };
  const payloadText = base64url(JSON.stringify(payload));
  return { token: `${payloadText}.${sign(payloadText, secret)}`, expiresAt: payload.exp };
}

// Verify a token. Returns { valid: true, payload } or { valid: false, reason }.
function verifyToken(token) {
  const secret = signingSecret();
  if (!secret) return { valid: false, reason: 'not-configured' };
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return { valid: false, reason: 'malformed' };
  const [payloadText, signature] = parts;
  if (!safeEqual(signature, sign(payloadText, secret))) return { valid: false, reason: 'bad-signature' };
  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadText));
  } catch (_) {
    return { valid: false, reason: 'malformed' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.exp !== 'number' || payload.exp <= now) {
    return { valid: false, reason: 'expired' };
  }
  return { valid: true, payload };
}

// Pull a token from the Authorization header or the admin cookie.
function tokenFromRequest(request) {
  const header = String((request && request.headers && request.headers.authorization) || '');
  const bearer = header.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const cookie = String((request && request.headers && request.headers.cookie) || '');
  const match = cookie.match(/(?:^|;\s*)greencart_admin=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

// The one function every admin endpoint calls. Returns the payload on success and
// null on any failure, because the caller must not be told WHICH check failed.
function authenticate(request) {
  const result = verifyToken(tokenFromRequest(request));
  return result.valid ? result.payload : null;
}

module.exports = {
  isConfigured,
  checkPassword,
  issueToken,
  verifyToken,
  tokenFromRequest,
  authenticate,
  DEFAULT_TTL_SECONDS
};
