// /api/admin/state
//
// GET — the shared storefront document (catalogue, promotions, customer statuses).
// PUT — replace it, refusing a write based on a stale version.
//
// WHY A VERSION AND NOT A PLAIN PUT
// Two devices editing the same catalogue: a blind overwrite loses one of the two
// edits with no warning. `writeDocument` refuses a write whose version has moved
// on, so the owner is told to reload instead of quietly losing a price change.

const { readJson, send, rejectMethod } = require('../_lib/http');
const { isConfigured, createRunner, migrate } = require('../../db');
const { readDocument, writeDocument } = require('../../db/state');
const session = require('../_lib/session');

module.exports = async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return rejectMethod(response, 'GET, PUT');
  }

  if (!session.isConfigured()) {
    return send(response, 503, {
      success: false,
      message: 'The admin area is not configured on this deployment. Set ADMIN_PASSWORD to enable it.'
    });
  }
  if (!session.authenticate(request)) {
    return send(response, 401, { success: false, message: 'Sign in to the admin area to continue.' });
  }
  if (!isConfigured()) {
    return send(response, 503, {
      success: false,
      message: 'The shared database is not configured on this deployment, so the catalogue cannot be shared.'
    });
  }

  const run = createRunner();
  await migrate(run);

  if (request.method === 'GET') {
    const current = await readDocument(run);
    // `doc: null` with `version: 0` means "nothing has been saved yet", which is
    // the correct starting point for a new shop. It is not an error.
    return send(response, 200, {
      success: true,
      doc: current ? current.doc : null,
      version: current ? current.version : 0,
      updatedAt: current ? current.updatedAt : null
    });
  }

  const body = await readJson(request);
  if (!body || typeof body !== 'object') {
    return send(response, 400, { success: false, message: 'The request body could not be read.' });
  }

  const result = await writeDocument(run, body.doc, body.version);
  if (result.written) {
    return send(response, 200, { success: true, version: result.version });
  }
  if (result.reason === 'invalid') {
    return send(response, 400, { success: false, message: result.message });
  }
  // A conflict is not a server error; it is the owner needing to reload.
  return send(response, 409, {
    success: false,
    version: result.version,
    message: 'Someone else changed the shop on another device. Reload to see their change before saving yours.'
  });
};
