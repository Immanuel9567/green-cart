// The storefront document, as the server sees it.
//
// WHAT THIS IS FOR
// The shop's catalogue, promotions and customer statuses live in one JSON
// document (see db/schema.sql). The browser keeps showing the shop instantly
// from localStorage; this layer is what makes that data SHARED — the same
// catalogue and the same orders on the owner's phone, the owner's laptop and a
// customer's browser.
//
// THE PROBLEM IT HAS TO SOLVE
// Two devices editing the same document. If the owner changes a price on a phone
// while a laptop still holds the old document, a blind overwrite loses one of
// them. So every write carries the version it was based on:
//
//   read version 7 -> edit -> write "I am replacing version 7"
//
// If the stored version is still 7, the write succeeds and becomes version 8.
// If it is not, the write is REJECTED and the caller is told, so the owner can
// reload rather than silently losing their change. This is optimistic
// concurrency, and it is the whole reason this file exists rather than a PUT.
//
// WHAT IS DELIBERATELY NOT STORED HERE
// Orders. An order is a financial record with its own table, its own integer
// money and its own audit trail (db/schema.sql). Dropping orders into a JSON
// blob would lose exactly the guarantees that table exists to provide.

const DOCUMENT_ID = 'default';

// A document is only accepted if it looks like the shop's document. Anything
// else is rejected before it can overwrite real data with a shape nothing reads.
const REQUIRED_ARRAYS = ['products', 'orders', 'promotions', 'wishlist', 'cart'];

function validateDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return 'The document must be an object.';
  }
  for (const key of REQUIRED_ARRAYS) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) {
      return `The document's "${key}" must be a list.`;
    }
  }
  if (doc.products && doc.products.length > 5000) return 'The catalogue is too large to store.';
  if (doc.customerStatuses && (typeof doc.customerStatuses !== 'object' || Array.isArray(doc.customerStatuses))) {
    return 'The document\'s "customerStatuses" must be an object.';
  }
  return null;
}

// Read the shared document.
//
// Returns { doc, version, updatedAt } or null when nothing has been saved yet.
// A missing document is NOT an error: it is a shop that has never saved, and the
// browser's seed catalogue is the correct starting point.
async function readDocument(run) {
  const result = await run(
    'SELECT doc, version, updated_at FROM shop_state WHERE id = ?',
    [DOCUMENT_ID]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    // Postgres returns jsonb already parsed; SQLite returns the string we stored.
    doc: typeof row.doc === 'string' ? JSON.parse(row.doc) : row.doc,
    version: Number(row.version) || 1,
    updatedAt: row.updated_at || null
  };
}

// Write the shared document, rejecting a stale write.
//
// `expectedVersion` is what the caller last read (0 or null for "I believe
// nothing is stored"). Returns:
//   { written: true, version }
//   { written: false, reason: 'conflict', version }  — someone else wrote first
//   { written: false, reason: 'invalid', message }    — the document is junk
async function writeDocument(run, doc, expectedVersion = 0) {
  const invalid = validateDocument(doc);
  if (invalid) return { written: false, reason: 'invalid', message: invalid };

  const expected = Number(expectedVersion) || 0;
  const serialised = JSON.stringify(doc);

  if (expected === 0) {
    // First write: only claim the row if it does not exist. ON CONFLICT DO
    // NOTHING makes that atomic, so two devices racing to create the document
    // cannot both succeed.
    const inserted = await run(
      'INSERT INTO shop_state (id, doc, version) VALUES (?, ?, 1) ON CONFLICT (id) DO NOTHING RETURNING version',
      [DOCUMENT_ID, serialised]
    );
    if (inserted.rows.length) return { written: true, version: Number(inserted.rows[0].version) || 1 };
    const current = await readDocument(run);
    return { written: false, reason: 'conflict', version: current ? current.version : null };
  }

  // Subsequent write: only succeed if the version is still the one we read.
  const updated = await run(
    // CURRENT_TIMESTAMP rather than NOW(): both Postgres and SQLite understand it,
    // so the same statement is exercised by the tests and by production.
    'UPDATE shop_state SET doc = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ? RETURNING version',
    [serialised, DOCUMENT_ID, expected]
  );
  if (updated.rows.length) {
    return { written: true, version: Number(updated.rows[0].version) || expected + 1 };
  }

  const current = await readDocument(run);
  if (!current) {
    // The row vanished between the read and the write. Treat it as a fresh
    // creation rather than losing the edit entirely.
    return writeDocument(run, doc, 0);
  }
  return { written: false, reason: 'conflict', version: current.version };
}

module.exports = { DOCUMENT_ID, readDocument, writeDocument, validateDocument };
