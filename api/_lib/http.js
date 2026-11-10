// Minimal HTTP helpers for the payment endpoints.
//
// WHY THIS EXISTS RATHER THAN VERCEL'S HELPERS
// Vercel adds convenience methods to the request and response objects:
// `request.body`, `response.status()`, `response.json()`. They are handy, but
// they create a problem for this gateway:
//
//   - `request.body` is a LAZY GETTER that parses the body when read. The
//     Paystack webhook needs the exact original bytes to check an HMAC
//     signature, and a parsed-and-re-serialised body can never match. So the
//     webhook must not touch `request.body` at all.
//   - The documented way to switch those helpers off is a PROJECT-WIDE
//     environment variable (`NODEJS_HELPERS=0`), which would remove
//     `response.status()`/`response.json()` from the other two endpoints too.
//
// Rather than depend on which mode the project happens to be in, these three
// endpoints use only standard Node HTTP. They therefore behave identically with
// Vercel's helpers on or off, and would run on any Node host without change.

// Read the request body as raw bytes.
//
// The stream is checked FIRST and `request.body` is only consulted if there is
// no stream. That order matters: reading `request.body` on Vercel would invoke
// the parser, consume the stream, and destroy the bytes a signature needs.
async function readRawBody(request) {
  if (!request) throw new Error('No request.');

  if (typeof request.pipe === 'function' || typeof request[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    }
    if (chunks.length) return Buffer.concat(chunks).toString('utf8');
    // An empty stream is a legitimate empty body, not a failure.
    return '';
  }

  // Web-standard Request (other runtimes, or a future Vercel default).
  if (typeof request.text === 'function') return await request.text();

  // A body already provided as raw text, e.g. by a test harness.
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body.toString('utf8');

  // Already parsed by something else: the original bytes are gone and no
  // signature could ever match. Fail loudly instead of rejecting every real
  // webhook forever with no explanation.
  throw new Error('The raw request body was not available (it was already parsed).');
}

async function readJson(request) {
  const raw = await readRawBody(request);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return undefined; // distinct from null: "present but unparseable"
  }
}

function send(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.statusCode = statusCode;
  if (typeof response.setHeader === 'function') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', Buffer.byteLength(body));
  }
  if (typeof response.end === 'function') {
    response.end(body);
  } else if (typeof response.json === 'function') {
    // A platform-shaped response object (some hosts).
    response.status(statusCode).json(payload);
  }
  return response;
}

// 405 for anything that is not the expected method, with a correct Allow header.
function rejectMethod(response, allowed) {
  if (typeof response.setHeader === 'function') response.setHeader('Allow', allowed);
  return send(response, 405, { success: false, message: `Use ${allowed}.` });
}

module.exports = { readRawBody, readJson, send, rejectMethod };
