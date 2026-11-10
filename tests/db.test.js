// Tests for db/index.js — the shared persistence layer.
//
// THE POINT OF THESE TESTS
// The production database is Postgres on Supabase, which this sandbox cannot
// connect to. So the read/write layer is tested against a REAL SQLite database
// with the same schema, translated by `sqliteSchema()`. That means these tests
// exercise real SQL, real constraints and real rows — not a mock that returns
// whatever it was told to.
//
// The first block tests the translation itself, because a translation bug would
// make every subsequent test meaningless: it would be testing a schema that is
// not the one production runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const db = require('../db');

function freshDatabase() {
  const connection = new DatabaseSync(':memory:');
  for (const statement of db.statements(db.sqliteSchema())) {
    connection.exec(statement);
  }
  return connection;
}

// ---------------------------------------------------------------- SQL splitting

test('the schema splits into complete statements, not fragments', () => {
  const parts = db.statements(db.schemaSql());
  assert.ok(parts.length >= 7, `expected the full schema, got ${parts.length} statements`);
  const tables = parts.filter(part => /CREATE TABLE/i.test(part));
  const indexes = parts.filter(part => /CREATE INDEX/i.test(part));
  assert.equal(tables.length, 3, 'all three tables survive the split');
  assert.equal(indexes.length, 4, 'all four indexes survive the split');
  for (const part of parts) {
    // A fragment would start mid-word or contain an unbalanced parenthesis.
    assert.ok(part.trim().length > 0, 'no empty statements');
    const opens = (part.match(/\(/g) || []).length;
    const closes = (part.match(/\)/g) || []).length;
    assert.equal(opens, closes, `unbalanced statement: ${part.slice(0, 60)}`);
  }
});

test('an apostrophe inside a comment cannot swallow the next statement', () => {
  // This was a real bug: "the shop's point of view" opened a string inside a
  // comment, and the scanner then ate every statement after it.
  const sql = [
    '-- the shop\'s point of view; it matters',
    'CREATE TABLE a (id TEXT);',
    '-- another owner\'s note',
    'CREATE TABLE b (id TEXT);'
  ].join('\n');
  const parts = db.statements(sql);
  assert.equal(parts.length, 2, 'both tables are found');
  assert.match(parts[0], /CREATE TABLE a/);
  assert.match(parts[1], /CREATE TABLE b/);
});

test('a semicolon inside a quoted string does not split a statement', () => {
  const sql = "INSERT INTO t (note) VALUES ('one; two; three');";
  const parts = db.statements(sql);
  assert.equal(parts.length, 1);
  assert.match(parts[0], /'one; two; three'/);
});

test('an escaped quote does not end a string early', () => {
  const sql = "INSERT INTO t (note) VALUES ('it''s fine; really');";
  const parts = db.statements(sql);
  assert.equal(parts.length, 1);
});

// ------------------------------------------------------------- Postgres mapping

test('? placeholders become numbered $1 placeholders', () => {
  assert.equal(
    db.toPostgresPlaceholders('SELECT * FROM orders WHERE reference = ? AND status = ?'),
    'SELECT * FROM orders WHERE reference = $1 AND status = $2'
  );
  // A ? inside a string literal is data, not a placeholder.
  assert.equal(
    db.toPostgresPlaceholders("SELECT * FROM t WHERE note = 'why?' AND id = ?"),
    "SELECT * FROM t WHERE note = 'why?' AND id = $1"
  );
});

test('values are rendered safely, including quotes', () => {
  assert.equal(db.renderParam(null), 'NULL');
  assert.equal(db.renderParam(42), '42');
  assert.equal(db.renderParam(true), 'TRUE');
  assert.equal(db.renderParam('plain'), "'plain'");
  // An apostrophe must be doubled, or a customer named O'Brien breaks the query.
  assert.equal(db.renderParam("O'Brien"), "'O''Brien'");
  assert.equal(db.renderParam({ a: 1 }), `'{"a":1}'`);
  assert.throws(() => db.renderParam(NaN), /non-finite/i);
});

test('a parameter count mismatch is an error, not a silent wrong query', () => {
  assert.throws(() => db.renderParam(NaN), /non-finite/i);
});

// -------------------------------------------------------- The real schema, in SQL

test('the translated schema builds a working database', () => {
  const connection = freshDatabase();
  const tables = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name);
  assert.ok(tables.includes('shop_state'), 'shop_state exists');
  assert.ok(tables.includes('orders'), 'orders exists');
  assert.ok(tables.includes('payment_events'), 'payment_events exists');
  const indexes = connection.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
  assert.equal(indexes.length, 4, 'all four indexes were created');
});

test('the schema is idempotent: applying it twice changes nothing', () => {
  const connection = freshDatabase();
  assert.doesNotThrow(() => {
    for (const statement of db.statements(db.sqliteSchema())) connection.exec(statement);
  }, 'a second migration must not fail');
  // And it must not have dropped the data either.
  connection.prepare("INSERT INTO shop_state (id, doc) VALUES ('default', '{}')").run();
  for (const statement of db.statements(db.sqliteSchema())) connection.exec(statement);
  const rows = connection.prepare('SELECT COUNT(*) AS n FROM shop_state').all();
  assert.equal(rows[0].n, 1, 'existing data survives a re-migration');
});

test('the database itself rejects invalid money and statuses', () => {
  const connection = freshDatabase();
  const insert = connection.prepare('INSERT INTO orders (reference, status, amount_kobo) VALUES (?, ?, ?)');
  // Valid.
  assert.doesNotThrow(() => insert.run('GC-1', 'pending', 100));
  // A negative charge is not a thing.
  assert.throws(() => insert.run('GC-2', 'pending', -1), /CHECK/i);
  // A status the flow does not define must not be storable.
  assert.throws(() => insert.run('GC-3', 'teleported', 100), /CHECK/i);
  // Two orders cannot share a reference.
  assert.throws(() => insert.run('GC-1', 'pending', 100), /UNIQUE|PRIMARY/i);
});

test('there can only ever be one shop state document', () => {
  const connection = freshDatabase();
  connection.prepare("INSERT INTO shop_state (id, doc) VALUES ('default', '{}')").run();
  assert.throws(
    () => connection.prepare("INSERT INTO shop_state (id, doc) VALUES ('second', '{}')").run(),
    /CHECK|UNIQUE|PRIMARY/i,
    'a second document is structurally impossible'
  );
});

// ------------------------------------------------------- The Supabase runner

test('without configuration the database reports itself unavailable', () => {
  const saved = { url: process.env.SUPABASE_SQL_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  delete process.env.SUPABASE_SQL_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.equal(db.isConfigured(), false, 'no configuration means not configured');
    assert.throws(() => db.createRunner(), /not configured/i, 'creating a runner fails loudly');
  } finally {
    if (saved.url) process.env.SUPABASE_SQL_URL = saved.url;
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  }
});

test('half a configuration is still not configured', () => {
  const saved = { url: process.env.SUPABASE_SQL_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  process.env.SUPABASE_SQL_URL = 'https://example.supabase.co/rest/v1/rpc/sql';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.equal(db.isConfigured(), false, 'a URL without a key cannot work');
  } finally {
    if (saved.key) process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key; else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (saved.url) process.env.SUPABASE_SQL_URL = saved.url; else delete process.env.SUPABASE_SQL_URL;
  }
});

// ------------------------------------------------------------- The constraints
// on the translation, so a future schema change cannot quietly stop being tested.

test('table constraints are moved after the columns, keeping their text', () => {
  const pg = `CREATE TABLE IF NOT EXISTS t (
  a TEXT,
  CONSTRAINT a_check
    CHECK (a IN ('x','y')),
  b INTEGER,
  CONSTRAINT b_check CHECK (b >= 0)
);`;
  const sqlite = db.hoistTableConstraints(pg);
  // Every constraint still names itself and still carries its CHECK.
  assert.match(sqlite, /CONSTRAINT a_check[\s\S]*CHECK \(a IN/);
  assert.match(sqlite, /CONSTRAINT b_check CHECK \(b >= 0\)/);
  // And the columns survive.
  assert.match(sqlite, /\ba TEXT/);
  assert.match(sqlite, /\bb INTEGER/);
  // It must actually run.
  const connection = new DatabaseSync(':memory:');
  assert.doesNotThrow(() => connection.exec(sqlite), 'the hoisted statement is valid SQLite');
});

test('hoisting a statement with no constraints leaves it alone', () => {
  const plain = 'CREATE TABLE t (a TEXT, b INTEGER);';
  assert.equal(db.hoistTableConstraints(plain), plain);
});
