#!/usr/bin/env node
// Mutation check: deliberately break one rule at a time and confirm the test
// suite notices. A mutation that leaves every test green means the behaviour
// is not actually covered, however good the suite looks.
//
//   npm run test:mutation
//
// Each case edits a source file, runs `npm test`, then restores the file from
// the in-memory original even if the run throws. It never leaves the tree
// modified, and it refuses to start if the baseline suite is already failing.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

const cases = [
  {
    name: 'discount rounding falls back to dollar-level rounding',
    file: 'js/store.js',
    from: `    const subtotalCents = Math.round(subtotal * 100);
    const discountCents = Math.floor((subtotalCents * percent + 50) / 100);
    return Math.min(subtotal, discountCents / 100);`,
    to: `    return Math.min(subtotal, Math.round(subtotal * percent) / 100);`
  },
  {
    name: 'fixed-amount discounts are not capped to the subtotal',
    file: 'js/store.js',
    from: `if (promotion.type === 'amount') return Math.min(subtotal, Math.max(0, Number(promotion.amount) || 0));`,
    to: `if (promotion.type === 'amount') return Math.max(0, Number(promotion.amount) || 0);`
  },
  {
    name: 'order status accepts any status (no flow)',
    file: 'js/store.js',
    from: `    if (!allowed.includes(status)) {
      throw new Error(\`This order can only move from \${order.status} to \${allowed.join(' or ')}.\`);
    }`,
    to: ''
  },
  {
    name: 'cancelling does not restock items',
    file: 'js/store.js',
    from: `    const products = status === 'cancelled' ? this.restockOrderItems(order) : this.products;`,
    to: `    const products = this.products;`
  },
  {
    name: 'refunds are allowed before dispatch',
    file: 'js/store.js',
    from: `    if (!refundableStatuses.includes(order.status)) {`,
    to: `    if (false) {`
  },
  {
    name: 'archived products are not excluded from the storefront',
    file: 'js/store.js',
    from: `  get availableProducts() { return this.state.products.filter(product => !product.archived); }`,
    to: `  get availableProducts() { return this.state.products; }`
  },
  {
    name: 'products with past orders can be deleted',
    file: 'js/store.js',
    from: `    if (this.productHasSales(id)) {
      throw new Error('This product appears in past orders, so it can only be archived. Archive it instead to keep its order history.');
    }`,
    to: ''
  },
  {
    name: 'archiving leaves the product in the bag',
    file: 'js/store.js',
    from: `    const available = products.filter(product => !product.archived);`,
    to: `    const available = products;`
  },
  {
    name: 'low-stock alert counts archived products',
    file: 'js/store.js',
    from: `lowStock: this.availableProducts.filter(product => product.stock < 5).length`,
    to: `lowStock: this.products.filter(product => product.stock < 5).length`
  },
  {
    name: 'unreadable saved data is discarded silently',
    file: 'js/store.js',
    from: `      const unreadable = saved === null || typeof saved !== 'object';`,
    to: `      const unreadable = false;`
  },
  {
    name: 'a first visit is mistaken for unreadable saved data',
    file: 'js/store.js',
    from: `    if (raw !== null) {`,
    to: `    if (true) {`
  },
  {
    name: 'the recovery banner is never shown',
    file: 'js/app.js',
    from: `  banner.hidden = false;`,
    to: `  banner.hidden = true;`
  },
  {
    name: 'a save under the old brand key is ignored',
    file: 'js/store.js',
    from: `      const legacyKey = LEGACY_STORE_STATE_KEYS.find(key => this.readRaw(key) !== null);`,
    to: `      const legacyKey = undefined;`
  },
  {
    name: 'a legacy save overrides the current one',
    file: 'js/store.js',
    from: `    if (this.readRaw(STORE_STATE_KEY) === null) {`,
    to: `    if (true) {`
  },
  {
    name: 'empty rows hard-code five columns, whatever the table has',
    file: 'js/app.js',
    from: `    const columns = body.closest('table').querySelectorAll('thead th').length;`,
    to: `    const columns = 5;`
  },
  {
    name: 'a shrunk list keeps its old page instead of clamping back into range',
    file: 'js/app.js',
    from: `  const { items: pageItems, total } = paginate(items, state.page, ADMIN_PAGE_SIZE);`,
    to: `  const { items: pageItems, total } = { items: items.slice(0, ADMIN_PAGE_SIZE), total: items.length };`
  },
  {
    name: 'page changes are not announced to assistive tech',
    file: 'js/app.js',
    from: `  announceListChange(state.key, total === 0 ? '' : summary);`,
    to: `  /* announcement removed */`
  },
  {
    name: 'the live region is rebuilt with the pager instead of persisting',
    file: 'js/app.js',
    from: `    void announcer.offsetWidth;`,
    to: `    announcer.remove();`
  },
  {
    name: 'paging drops keyboard focus back to the page body',
    file: 'js/app.js',
    from: `  if (hadFocusInside) restorePagerFocus(container, focusedDelta);`,
    to: `  if (false) restorePagerFocus(container, focusedDelta);`
  },
  {
    name: 'end-of-list fallback skips to the body instead of a usable control',
    file: 'js/app.js',
    from: `  for (const value of order) {
    const button = container.querySelector(\`[data-page-delta="\${value}"]\`);
    if (button && !button.disabled) { button.focus(); return; }
  }`,
    to: `  for (const value of order) {
    const button = container.querySelector(\`[data-page-delta="\${value}"]\`);
    if (button && !button.disabled) { button.blur(); return; }
  }`
  },
  {
    name: 'status filters are ignored (every status shows)',
    file: 'js/app.js',
    from: `(adminPromoFilter === 'all' || status(promo) === adminPromoFilter)`,
    to: `(adminPromoFilter === 'all' || true)`
  },
  {
    name: 'customer search ignores the customer name',
    file: 'js/app.js',
    from: `matchesQuery(state.query, customer.name, customer.email, customerCities(customer))`,
    to: `matchesQuery(state.query, customer.email, customerCities(customer))`
  },
  {
    name: 'a page past the end is not clamped to the last page',
    file: 'js/store.js',
    from: `  const current = Math.min(pageCount, Math.max(1, requested));`,
    to: `  const current = Math.max(1, requested);`
  },
  {
    name: 'last page is not truncated to the remaining items',
    file: 'js/store.js',
    from: `items: list.slice(start, start + size) };`,
    to: `items: list.slice(start) };`
  },
  {
    name: 'search ignores the trimmed query (whitespace breaks matching)',
    file: 'js/store.js',
    from: `  const needle = String(query == null ? '' : query).trim().toLowerCase();`,
    to: `  const needle = String(query == null ? '' : query).toLowerCase();`
  },
  {
    name: 'search is case-sensitive',
    file: 'js/store.js',
    from: `  return values.some(value => String(value == null ? '' : value).toLowerCase().includes(needle));`,
    to: `  return values.some(value => String(value == null ? '' : value).includes(needle));`
  },
  {
    name: 'bag can exceed available stock',
    file: 'js/store.js',
    from: `    if (quantity > available) throw new Error(available > 0 ? \`Only \${available} more available.\` : 'No more of this item are available.');`,
    to: ``
  },
  {
    name: 'naira prices are converted without the pinned rate',
    file: 'js/currency.js',
    from: `    return value * rate;`,
    to: `    return value;`
  },
  {
    name: 'a payment is marked paid without asking the server',
    file: 'js/payments.js',
    from: `                if (result.verified) {`,
    to: `                if (true) {`
  },
  {
    name: 'checkout proceeds even though payments are switched off',
    file: 'js/app.js',
    from: `  if (!status.enabled) {`,
    to: `  if (false) {`
  },
  {
    name: 'dollars are turned into kobo without going through naira',
    file: 'api/_lib/pricing.js',
    from: `  return Math.round(Number(usdAmount) * NGN_PER_USD * 100);`,
    to: `  return Math.round(Number(usdAmount) * 100);`
  },
  {
    name: 'the webhook accepts a request with no valid signature',
    file: 'api/paystack-webhook.js',
    from: `  if (!authentic) {`,
    to: `  if (false) {`
  },
  {
    name: 'verification accepts an amount different from the quote',
    file: 'api/verify-payment.js',
    from: `  if (Number.isFinite(expectedKobo) && expectedKobo > 0 && Number(transaction.amount) !== expectedKobo) {`,
    to: `  if (false) {`
  },
  {
    name: 'a secret key pasted into the public config is shipped anyway',
    file: 'js/payments.js',
    from: `    if (keyLooksSecret(PUBLIC_KEY)) {
      return { enabled: false, reason: 'secret-key-in-config' };
    }`,
    to: ''
  },
  {
    name: 'the webhook trusts a parsed body instead of the signed bytes',
    file: 'api/paystack-webhook.js',
    from: `    event = JSON.parse(rawBody);`,
    to: `    event = request.body;`
  },
  {
    name: 'a payment is confirmed without checking the amount matches the quote',
    file: 'api/verify-payment.js',
    from: `  if (Number.isFinite(expectedKobo) && expectedKobo > 0 && Number(transaction.amount) !== expectedKobo) {`,
    to: `  if (false) {`
  },
  {
    name: 'the legal pages present themselves as finished while details are placeholders',
    file: 'js/legal.js',
    from: `  document.querySelectorAll('[data-contact-warning]').forEach(warning => {
    if (!missing.length) {`,
    to: `  document.querySelectorAll('[data-contact-warning]').forEach(warning => {
    if (true) {`
  }
];

const runTests = () => {
  try {
    execFileSync('npm', ['test'], { cwd: root, stdio: 'pipe' });
    return { passed: true, output: '' };
  } catch (error) {
    return { passed: false, output: `${error.stdout || ''}${error.stderr || ''}` };
  }
};

const failingTests = output => [...new Set(
  [...output.matchAll(/^not ok \d+ - (.+)$/gm)].map(match => match[1].trim())
)];

// Refuse to start on a tree with uncommitted changes to the files this script
// edits. A half-applied mutation looks exactly like a dirty working tree, and
// starting from one means the next failure is impossible to attribute. This is
// the guard that would have caught the interrupted run that left a mutation in
// js/store.js. Only the files it mutates are checked, so ordinary work in
// progress elsewhere does not block a run.
function dirtyTargets(files) {
  try {
    const entries = files.map(file => path.relative(root, path.join(root, file))).join(' ');
    return execFileSync('git', ['status', '--porcelain', '--', ...entries.split(' ')], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch (_) {
    return ''; // no git, or the files are untracked: nothing to compare against
  }
}

const targetFiles = [...new Set(cases.map(testCase => testCase.file))];
const dirty = dirtyTargets(targetFiles);
if (dirty && process.env.ALLOW_DIRTY !== '1') {
  console.error(`Refusing to run: these files have uncommitted changes, which may be a leftover mutation:\n\n${dirty}\n`);
  console.error('Commit or discard them first, then re-run `npm run test:mutation`.');
  console.error('If the changes are deliberate work in progress, the run is still safe to start');
  console.error('from their current contents; re-run with ALLOW_DIRTY=1 to say so explicitly.');
  process.exit(1);
}
if (dirty) {
  console.log('Starting from uncommitted changes (ALLOW_DIRTY=1); each case is diffed against');
  console.log('the state found at startup, not against git HEAD.\n');
}

if (!runTests().passed) {
  console.error('Baseline `npm test` is already failing. Fix that before running mutation checks.');
  process.exit(1);
}
console.log('Baseline: npm test passes.\n');

let survivors = 0;
// A `finally` block restores the file after an exception, but it never runs if
// the process is interrupted (Ctrl-C, or the runner being stopped). Track the
// file currently mutated so a signal or hard exit can still put it back; an
// interrupted run once left a mutation in place and the next `npm test` failed
// for a reason nobody had caused deliberately.
let inFlight = null;

function restoreInFlight() {
  if (!inFlight) return;
  try { fs.writeFileSync(inFlight.file, inFlight.original); } catch (_) { /* best effort */ }
  inFlight = null;
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreInFlight();
    console.log(`\nInterrupted - restored ${path.relative(root, inFlight ? inFlight.file : '') || 'the tree'}.`);
    process.exit(130);
  });
}
process.on('exit', restoreInFlight);
process.on('uncaughtException', error => {
  restoreInFlight();
  console.error(error);
  process.exit(1);
});

for (const testCase of cases) {
  const file = path.join(root, testCase.file);
  const original = fs.readFileSync(file, 'utf8');
  if (!original.includes(testCase.from)) {
    console.log(`?? SKIPPED  ${testCase.name}\n   pattern not found in ${testCase.file} - update this case`);
    survivors++;
    continue;
  }
  inFlight = { file, original };
  fs.writeFileSync(file, original.replace(testCase.from, testCase.to));
  try {
    const result = runTests();
    if (result.passed) {
      survivors++;
      console.log(`?? SURVIVED ${testCase.name}\n   the suite still passes, so this behaviour is not covered`);
    } else {
      const names = failingTests(result.output).slice(0, 3).join(' | ') || 'suite failed';
      console.log(`OK killed   ${testCase.name}\n   -> ${names}`);
    }
  } finally {
    fs.writeFileSync(file, original);
    inFlight = null;
  }
}

console.log(`\n${cases.length - survivors}/${cases.length} mutations caught.`);
if (survivors) {
  console.log(`${survivors} survived - add or tighten tests for those behaviours.`);
  process.exitCode = 1;
}
