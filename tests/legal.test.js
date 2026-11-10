// Tests for the legal pages and the store contact details.
//
// These pages exist because card networks require a reachable business. A
// privacy notice with "[email address]" in it is not a privacy notice, so the
// behaviour under test is: while details are missing, say so loudly and do not
// present the page as finished.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

function loadLegal(pageName, { contact } = {}) {
  const file = path.join(root, 'legal', pageName);
  const html = fs.readFileSync(file, 'utf8');
  const errors = [];
  const dom = new JSDOM(html, {
    url: 'https://shopgreencart.com/legal/' + pageName,
    runScripts: 'dangerously',
    resources: undefined,
    virtualConsole: undefined
  });
  const { window } = dom;
  window.addEventListener('error', event => errors.push(event.error || event.message));

  // The pages load /js/contact.js and /js/legal.js with src=/... which jsdom
  // does not fetch. Inject the same sources in the same order instead.
  const inject = rel => {
    const script = window.document.createElement('script');
    script.textContent = fs.readFileSync(path.join(root, rel), 'utf8');
    window.document.body.appendChild(script);
  };
  if (contact) window.GREENCART_CONTACT = contact;
  inject('js/contact.js');
  if (contact) window.GREENCART_CONTACT = contact; // override after defaults load
  inject('js/legal.js');

  return { window, document: window.document, errors, close: () => dom.window.close() };
}

test('every legal page exists and links back to the shop', () => {
  for (const page of ['shipping.html', 'privacy.html', 'terms.html', 'contact.html']) {
    const html = fs.readFileSync(path.join(root, 'legal', page), 'utf8');
    assert.match(html, /href="\/"/, `${page} must link back to the storefront`);
    assert.match(html, /data-contact-warning/, `${page} must be able to report missing details`);
  }
});

test('a placeholder detail is named in a visible warning', () => {
  const page = loadLegal('contact.html');
  try {
    const warning = page.document.querySelector('[data-contact-warning]');
    assert.equal(warning.hidden, false, 'the warning must be visible while details are placeholders');
    // It must name what is missing, not shrug.
    assert.match(warning.textContent, /email address/i);
    assert.match(warning.textContent, /WhatsApp number/i);
    assert.match(warning.textContent, /PLACEHOLDER/);
    assert.deepEqual(page.errors, []);
  } finally {
    page.close();
  }
});

test('a missing channel is hidden rather than rendered as an empty row', () => {
  const page = loadLegal('contact.html');
  try {
    const whatsapp = page.document.querySelector('[data-contact="whatsappDisplay"]');
    assert.equal(whatsapp.hidden, true, 'no WhatsApp number means no WhatsApp row');
  } finally {
    page.close();
  }
});

test('real details replace the placeholders and clear the warning', () => {
  const page = loadLegal('contact.html', {
    contact: {
      placeholder: false,
      businessName: 'GreenCart Ltd',
      addressLine: '12 Aba Road',
      city: 'Port Harcourt',
      state: 'Rivers State',
      country: 'Nigeria',
      email: 'help@shopgreencart.com',
      whatsapp: '2348030000000',
      hours: 'Monday to Saturday, 9am to 6pm (WAT)'
    }
  });
  try {
    const { document } = page;
    const warning = document.querySelector('[data-contact-warning]');
    assert.equal(warning.hidden, true, 'nothing is missing, so no warning');

    const email = document.querySelector('[data-contact="email"]');
    assert.match(email.textContent, /help@shopgreencart\.com/);
    assert.equal(email.querySelector('a').getAttribute('href'), 'mailto:help@shopgreencart.com');

    const whatsapp = document.querySelector('[data-contact="whatsappDisplay"]');
    assert.equal(whatsapp.hidden, false);
    assert.equal(whatsapp.textContent, '+234 803 000 0000');
    assert.match(whatsapp.querySelector('a').getAttribute('href'), /wa\.me\/2348030000000/);

    assert.match(document.querySelector('[data-contact="businessName"]').textContent, /GreenCart Ltd/);
  } finally {
    page.close();
  }
});

test('the privacy notice names the business once details are real', () => {
  const page = loadLegal('privacy.html', {
    contact: {
      businessName: 'GreenCart Ltd',
      addressLine: '12 Aba Road',
      city: 'Port Harcourt',
      state: 'Rivers State',
      country: 'Nigeria',
      email: 'help@shopgreencart.com',
      whatsapp: '2348030000000'
    }
  });
  try {
    const body = page.document.querySelector('.legal-page').textContent;
    // A privacy notice that names no one responsible is not a privacy notice.
    assert.match(body, /GreenCart Ltd/);
    assert.match(body, /12 Aba Road/);
    assert.match(body, /help@shopgreencart\.com/);
  } finally {
    page.close();
  }
});

test('shipped contact details are still placeholders', () => {
  // This is the guard that stops the site being presented as finished. It fails
  // the moment the real details are filled in, which is the point: deliberately
  // nothing here should silently become production-ready.
  const page = loadLegal('contact.html');
  try {
    const missing = page.window.GREENCART_CONTACT_MISSING();
    assert.ok(missing.length > 0, 'the committed contact details must not look complete');
    assert.ok(page.window.GREENCART_CONTACT.placeholder, 'placeholder flag must stay true until replaced');
  } finally {
    page.close();
  }
});
