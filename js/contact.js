// Store contact details.
//
// These are the details the legal pages and the footer display. They are in one
// place because card networks require a reachable contact route, and a phone
// number that is right on the contact page but stale in the footer is the same
// as no phone number at all.
//
// EVERY VALUE BELOW IS A PLACEHOLDER. The site shows them with a visible warning
// until they are replaced — see REQUIRED_BEFORE_LIVE. Replace the values here and
// the warning disappears everywhere at once.
//
// This file ships to the browser, so it must never contain anything secret.

window.GREENCART_CONTACT = {
  // Set to false only after every value below is real.
  placeholder: true,

  // The business name as it should appear to a customer. If it is registered
  // with the CAC, use the registered name.
  businessName: 'GreenCart',

  // A physical address customers can write to. A PO box alone is not enough for
  // some card networks; a city and state are the minimum.
  addressLine: '[street address]',
  city: 'Port Harcourt',
  state: 'Rivers State',
  country: 'Nigeria',

  // Support email. Must be a mailbox someone actually reads.
  email: '[email address]',

  // WhatsApp / phone in international format, digits only with country code,
  // e.g. '2348030000000'. Shown as +234 803 000 0000.
  whatsapp: '',

  // Optional. Shown on the contact page if present.
  instagram: '',

  // Business hours, as a plain sentence.
  hours: 'Monday to Saturday, 9am to 6pm (WAT)'
};

// Consumed by legal.js and by the footer. Kept as a list so a page can render a
// single warning naming everything that is still missing.
window.GREENCART_CONTACT_MISSING = function missing() {
  const contact = window.GREENCART_CONTACT || {};
  const gaps = [];
  if (!contact.email || /[\[\]]/.test(contact.email)) gaps.push('email address');
  if (!contact.addressLine || /[\[\]]/.test(contact.addressLine)) gaps.push('street address');
  if (!contact.whatsapp) gaps.push('WhatsApp number');
  return gaps;
};
