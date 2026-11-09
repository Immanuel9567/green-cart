// Fills the legal pages from js/contact.js.
//
// The pages are plain HTML with `data-contact` hooks so they still render
// something sensible if this script fails. Nothing here is required for the shop
// to work; the legal pages are informational.
//
// The warning banner is the important part. A privacy notice that says "contact
// us at [email address]" is not a privacy notice, so while any required detail
// is still a placeholder the page says so in the customer's face rather than
// looking finished.

(function () {
  const contact = window.GREENCART_CONTACT || {};

  function text(value, fallback) {
    const resolved = String(value == null ? '' : value).trim();
    if (!resolved || /[\[\]]/.test(resolved)) return fallback || '';
    return resolved;
  }

  function whatsappDisplay(number) {
    const digits = String(number || '').replace(/\D/g, '');
    if (!digits) return '';
    // 2348030000000 -> +234 803 000 0000
    if (digits.startsWith('234') && digits.length >= 13) {
      return `+234 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9, 13)}`;
    }
    return `+${digits}`;
  }

  const resolved = {
    businessName: text(contact.businessName, 'GreenCart'),
    addressLine: text(contact.addressLine),
    city: text(contact.city),
    state: text(contact.state),
    country: text(contact.country),
    email: text(contact.email),
    whatsapp: text(contact.whatsapp),
    whatsappDisplay: whatsappDisplay(contact.whatsapp),
    hours: text(contact.hours)
  };

  document.querySelectorAll('[data-contact]').forEach(element => {
    const key = element.dataset.contact;
    const value = resolved[key];
    if (!value) {
      element.hidden = true;
      return;
    }
    // A mailto: or wa.me link where one makes sense, plain text otherwise.
    if (key === 'email') {
      const link = document.createElement('a');
      link.href = `mailto:${value}`;
      link.textContent = value;
      element.replaceChildren(link);
    } else if (key === 'whatsappDisplay') {
      const link = document.createElement('a');
      link.href = `https://wa.me/${String(contact.whatsapp).replace(/\D/g, '')}`;
      link.rel = 'noopener';
      link.textContent = value;
      element.replaceChildren(link);
    } else {
      element.textContent = value;
    }
  });

  const missing = typeof window.GREENCART_CONTACT_MISSING === 'function'
    ? window.GREENCART_CONTACT_MISSING()
    : [];

  document.querySelectorAll('[data-contact-warning]').forEach(warning => {
    if (!missing.length) {
      warning.hidden = true;
      return;
    }
    warning.hidden = false;
    // Name exactly what is missing. "Details are incomplete" is a shrug; a list
    // is a to-do.
    warning.textContent = `PLACEHOLDER — REPLACE BEFORE TAKING REAL ORDERS. Still missing: ${missing.join(', ')}. A customer cannot reach the business through this page until these are filled in.`;
  });

  // The footer shows the support email without needing its own copy of it.
  document.querySelectorAll('[data-contact-footer]').forEach(element => {
    if (!resolved.email) {
      element.hidden = true;
      return;
    }
    const link = document.createElement('a');
    link.href = `mailto:${resolved.email}`;
    link.textContent = 'Help';
    element.replaceChildren(link);
  });
})();
