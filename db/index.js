// Server-side database access for GreenCart.
//
// WHAT THIS CONNECTS TO
// Supabase (Postgres). The connection is made over HTTPS using the project's
// service-role key, so it needs no extra npm dependency and works in a serverless
// function that is torn down between requests.
//
// WHY SQL OVER HTTPS AND NOT A POOLED CONNECTION
// Every Vercel function invocation is a fresh process. Opening a TCP Postgres
// connection per request is slow and exhausts the database's connection limit.
// Supabase exposes a SQL endpoint that takes one statement over HTTPS; that is
// what `createRunner()` uses. There is no long-lived socket to leak.
//
// WHAT THIS FILE REFUSES TO DO
//  - It never reads configuration from the browser. A missing key makes the
//    database unavailable, and every caller must handle that honestly rather
//    than pretending a write succeeded.
//  - It never falls back to a local file. A "database" that vanishes when the
//    function restarts is worse than no database, because it looks like one.

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

function readEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

// Is persistence switched on? Both values are required; one without the other
// cannot work, so the answer is no.
function isConfigured() {
  return Boolean(readEnv('SUPABASE_SQL_URL') && readEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

// The schema as text. Split into statements by `statements()`.
function schemaSql() {
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

// Split a SQL file into individual statements.
//
// This is NOT `sql.split(';')`. The schema is heavily commented and the prose
// contains semicolons, so a naive split glues half a comment onto the next
// statement — and a comment containing a semicolon can swallow a statement
// entirely. This walks the text and only splits on a semicolon that is outside a
// line comment, a block comment, and a quoted string.
function statements(sql) {
  const found = [];
  let current = '';
  let i = 0;
  let state = 'sql'; // 'sql' | 'line-comment' | 'block-comment' | 'single' | 'double'
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];

    if (state === 'sql') {
      // Consume both characters of the opener. Advancing by one leaves the second
      // '-' to be read again in `sql` state, which silently ends the comment.
      if (char === '-' && next === '-') { state = 'line-comment'; current += char + next; i += 2; continue; }
      if (char === '/' && next === '*') { state = 'block-comment'; current += char + next; i += 2; continue; }
      if (char === "'") { state = 'single'; current += char; i += 1; continue; }
      if (char === '"') { state = 'double'; current += char; i += 1; continue; }
      if (char === ';') {
        const trimmed = current.trim();
        if (trimmed) found.push(trimmed);
        current = '';
        i += 1;
        continue;
      }
      current += char; i += 1; continue;
    }

    // A comment is text, not code. An apostrophe in prose ("the shop's point of
    // view") must never open a string, or the scanner swallows every statement
    // after it. This is why the split is a real scanner and not a regex.
    if (state === 'line-comment') {
      current += char;
      if (char === '\n') state = 'sql';
      i += 1; continue;
    }

    if (state === 'block-comment') {
      current += char;
      if (char === '*' && next === '/') { current += next; i += 2; state = 'sql'; continue; }
      i += 1; continue;
    }

    // Quoted string: a doubled quote is an escaped quote, not a terminator.
    if (state === 'single') {
      current += char;
      if (char === "'" && next === "'") { current += next; i += 2; continue; }
      if (char === "'") state = 'sql';
      i += 1; continue;
    }

    current += char;
    if (char === '"' && next === '"') { current += next; i += 2; continue; }
    if (char === '"') state = 'sql';
    i += 1; continue;
  }
  const tail = current.trim();
  if (tail) found.push(tail);
  return found;
}

// Convert `?` placeholders to Postgres `$1, $2, ...` without touching a `?`
// inside a quoted string or a comment.
function toPostgresPlaceholders(sql) {
  let out = '';
  let index = 0;
  let state = 'sql';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (state === 'sql') {
      if (char === '-' && next === '-') { state = 'line-comment'; out += char + next; i += 2; continue; }
      if (char === "'") { state = 'single'; out += char; i += 1; continue; }
      if (char === '"') { state = 'double'; out += char; i += 1; continue; }
      if (char === '?') { index += 1; out += `$${index}`; i += 1; continue; }
      out += char; i += 1; continue;
    }
    if (state === 'line-comment') { out += char; if (char === '\n') state = 'sql'; i += 1; continue; }
    if (state === 'single') {
      out += char;
      if (char === "'" && next === "'") { out += next; i += 2; continue; }
      if (char === "'") state = 'sql';
      i += 1; continue;
    }
    out += char;
    if (char === '"' && next === '"') { out += next; i += 2; continue; }
    if (char === '"') state = 'sql';
    i += 1; continue;
  }
  return out;
}

// Values arriving from JSON are typed; Postgres needs them rendered. Booleans and
// numbers go in bare, strings are escaped, objects and arrays become JSON text,
// and null is a real SQL NULL.
function renderParam(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('A non-finite number cannot be stored.');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}

function render(sql, params) {
  if (!params || !params.length) return sql;
  const withPlaceholders = toPostgresPlaceholders(sql);
  let index = 0;
  return withPlaceholders.replace(/\$(\d+)/g, (match, digits) => {
    const position = Number(digits) - 1;
    if (position >= params.length) throw new Error(`SQL expected ${params.length} parameters but found $${digits}.`);
    index += 1;
    return renderParam(params[position]);
  });
}

// A runner that talks to Supabase's SQL endpoint.
//
// `run(sql, params)` resolves to `{ rows }`. Postgres returns rows for SELECT and
// RETURNING; a plain INSERT resolves with an empty array rather than undefined,
// so callers never have to guard.
function createRunner() {
  const endpoint = readEnv('SUPABASE_SQL_URL');
  const key = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (!endpoint || !key) {
    throw new Error('The database is not configured: SUPABASE_SQL_URL and SUPABASE_SERVICE_ROLE_KEY are both required.');
  }

  return async function run(sql, params = []) {
    const query = render(sql, params);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The service role key bypasses row-level security. It must never reach a
        // browser, and it is only ever read from the server environment here.
        apikey: key,
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify({ query })
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_) {
      throw new Error(`The database returned a response that is not JSON (HTTP ${response.status}).`);
    }

    if (!response.ok) {
      const message = payload && (payload.message || payload.error || payload.hint);
      throw new Error(`Database error (HTTP ${response.status}): ${message || text.slice(0, 200)}`);
    }
    // Two response shapes are in use and BOTH have been seen in the wild:
    //   [ { rows: [...] } ]     an array of result sets (Supabase's SQL endpoint)
    //   [ {...row}, {...row} ]  a plain array of rows
    // Reading only the first shape silently returns nothing for the second, which
    // looks exactly like a shop with no orders. That is the worst possible bug in
    // this file, so both are handled explicitly.
    let rows;
    if (Array.isArray(payload)) {
      if (payload.length && payload[0] && Array.isArray(payload[0].rows)) rows = payload[0].rows;
      else if (payload.length && payload[0] && Array.isArray(payload[0].result)) rows = payload[0].result;
      else rows = payload; // already a list of rows
    } else if (payload && Array.isArray(payload.rows)) {
      rows = payload.rows;
    } else if (payload && Array.isArray(payload.result)) {
      rows = payload.result;
    }
    return { rows: Array.isArray(rows) ? rows : [] };
  };
}

// Apply the schema. Every statement is `IF NOT EXISTS`, so this is safe to run on
// every cold start; it does not drop or rewrite data.
async function migrate(run) {
  const parts = statements(schemaSql());
  for (const statement of parts) {
    await run(statement);
  }
  return parts.length;
}

// A runner backed by a SQLite database object, used by the tests.
//
// Two jobs: let the whole read/write layer be tested against a real database the
// sandbox can run, and keep Postgres-specific SQL out of the callers. The caller
// writes portable SQL; this translates what it can and throws loudly on anything
// it cannot, rather than silently doing the wrong thing.
function sqliteRunner(db) {
  return async function run(sql, params = []) {
    const prepared = db.prepare(sql);
    const trimmed = sql.trim();
    if (/^\s*(SELECT|WITH)/i.test(trimmed) || /RETURNING/i.test(trimmed)) {
      return { rows: prepared.all(...params) };
    }
    prepared.run(...params);
    return { rows: [] };
  };
}

// Turn the Postgres schema into something SQLite will accept, for tests only.
// Each rewrite is explicit so a schema change that SQLite cannot model fails
// loudly instead of being tested as if it were fine.
function sqliteSchema(pgSql = schemaSql()) {
  const mapped = pgSql
    // Type order matters: the DEFAULT must be rewritten before the bare type,
    // or `DEFAULT NOW()` survives and SQLite rejects it as a function call.
    .replace(/TIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/gi, 'TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP')
    .replace(/TIMESTAMPTZ/gi, 'TEXT')
    // A JSONB column with a DEFAULT literal becomes TEXT with the same literal,
    // whatever the literal is. A bare JSONB then becomes TEXT.
    .replace(/JSONB(\s+NOT\s+NULL\s+DEFAULT\s+'[^']*')/gi, 'TEXT$1')
    .replace(/'([^']*)'::jsonb/gi, "'$1'")
    .replace(/::jsonb/gi, '')
    .replace(/JSONB/gi, 'TEXT')
    .replace(/BIGSERIAL\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    // An identity column is a primary key that fills itself. SQLite spells that
    // INTEGER PRIMARY KEY AUTOINCREMENT.
    .replace(/BIGINT\s+GENERATED\s+BY\s+DEFAULT\s+AS\s+IDENTITY\s+PRIMARY\s+KEY/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/BIGINT/gi, 'INTEGER')
    .replace(/NUMERIC\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, 'REAL')
    // SQLite cannot index a `lower()` expression in this form, so the test
    // database indexes the column itself. The Postgres schema keeps the
    // case-insensitive index; this is a deliberate divergence.
    .replace(/CREATE INDEX IF NOT EXISTS orders_email_idx ON orders \(lower\(customer_email\)\)/gi,
      'CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (customer_email)');

  // Rebuild each CREATE TABLE with its constraints in the position SQLite allows.
  return mapped.replace(/CREATE TABLE[\s\S]*?\);/gi, statement => hoistTableConstraints(statement));
}

// Postgres lets a table-level CONSTRAINT sit between column definitions. SQLite
// requires every table constraint to come AFTER the last column. This moves them
// to the end of the column list, preserving their order and their text.
//
// It is deliberately narrow: it only recognises a CONSTRAINT whose definition
// starts at the beginning of a line, which is how every constraint in schema.sql
// is written. Anything it does not recognise is left alone, so a new PostgreSQL
// feature fails the test loudly instead of being silently mis-translated.
function hoistTableConstraints(createStatement) {
  const open = createStatement.indexOf('(');
  const close = createStatement.lastIndexOf(')');
  if (open === -1 || close === -1 || close < open) return createStatement;

  const head = createStatement.slice(0, open + 1);
  const body = createStatement.slice(open + 1, close);
  const tail = createStatement.slice(close);

  // Walk the body line by line, tracking parenthesis depth. A `CONSTRAINT` that
  // starts at depth zero begins a table constraint; it runs to the end of the
  // line where depth returns to zero. Single-line constraints therefore end on
  // their own line, and wrapped ones span as many lines as they need.
  const kept = [];
  const moved = [];
  let capture = null;
  let depth = 0;

  for (const line of body.split('\n')) {
    if (capture) {
      capture.push(line);
      depth += (line.match(/\(/g) || []).length;
      depth -= (line.match(/\)/g) || []).length;
      if (depth <= 0) { moved.push(capture.join('\n')); capture = null; }
      continue;
    }
    const startsConstraint = /^\s*CONSTRAINT\s+/i.test(line);
    if (startsConstraint) {
      // A `CONSTRAINT name` line usually carries no parentheses of its own; its
      // `CHECK (...)` sits on the following line. Treat a name-only line as an
      // open constraint so the CHECK line is captured with it, not orphaned.
      const opens = (line.match(/\(/g) || []).length;
      const closes = (line.match(/\)/g) || []).length;
      const namesOnly = opens === 0 && closes === 0;
      depth = opens - closes;
      if (depth <= 0 && !namesOnly) moved.push(line);
      else capture = [line];
      continue;
    }
    kept.push(line);
  }
  // An unterminated capture is left in place rather than dropped: losing a
  // constraint would silently weaken the schema the tests run against.
  if (capture) kept.push(capture.join('\n'));
  if (!moved.length) return createStatement;

  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  kept[kept.length - 1] = kept[kept.length - 1].replace(/,\s*$/, '');
  const constraints = moved.map(block => block.replace(/,\s*$/, ''));
  return `${head}\n${kept.join('\n')},\n${constraints.join(',\n')}\n${tail}`;
}

module.exports = {
  isConfigured,
  createRunner,
  migrate,
  schemaSql,
  statements,
  toPostgresPlaceholders,
  renderParam,
  sqliteRunner,
  sqliteSchema,
  hoistTableConstraints
};
