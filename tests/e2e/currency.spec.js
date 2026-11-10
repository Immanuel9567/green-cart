const { test, expect } = require('@playwright/test');
const { openAdmin } = require('./helpers');

// These tests cover what the store's own defaults do. Other spec files pin USD
// because they assert cent-level arithmetic; the shipped default is naira, and
// that is asserted here rather than assumed anywhere else.

test('the store opens in naira and switches to dollars and back', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.goto('/');

  const toggle = page.locator('#currencyToggleBtn');
  await expect(toggle).toContainText('NGN');
  await expect(page.locator('#featuredPrice')).toHaveText('₦403,058');
  await expect(page.locator('.product-card').first().locator('.price-current')).toHaveText('₦403,058');

  await toggle.click();
  await expect(toggle).toContainText('USD');
  await expect(page.locator('#featuredPrice')).toHaveText('$299.00');
  await expect(page.locator('.product-card').first().locator('.price-current')).toHaveText('$299.00');

  await toggle.click();
  await expect(toggle).toContainText('NGN');
  await expect(page.locator('#featuredPrice')).toHaveText('₦403,058');
});

test('the currency choice survives a reload and repaints the bag', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.goto('/');
  await page.locator('#currencyToggleBtn').click(); // -> USD
  await page.reload();
  await expect(page.locator('#currencyToggleBtn')).toContainText('USD');

  await page.locator('.product-card').first().getByRole('button', { name: 'Add to bag' }).click();
  await page.locator('[data-tab="cart"]').click();
  await expect(page.locator('#cartTotal')).toHaveText('$299.00');

  // The bag is a modal, so the header is not clickable while it is open. Close
  // it, switch currency, and confirm the bag repaints in the new currency.
  await page.locator('#cartCloseBtn').click();
  await page.locator('#currencyToggleBtn').click(); // -> NGN
  await page.locator('[data-tab="cart"]').click();
  await expect(page.locator('#cartTotal')).toHaveText('₦403,058');
});

test('switching currency never changes what an order is worth', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.addInitScript(() => {
    window.GREENCART_CONFIG = {
      payments: { publicKey: 'pk_test_e2e' }
    };
    window.PaystackPop = {
      setup(options) {
        return {
          openIframe() {
            window.__amount = options.amount;
            window.__currency = options.currency;
            Promise.resolve().then(() => options.callback({ reference: 'PSK-CUR' }));
          }
        };
      }
    };
  });
  await page.route('**/api/initialize-payment', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, reference: 'PSK-CUR', amount: 40305798, currency: 'NGN' })
  }));
  await page.route('**/api/verify-payment', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, reference: 'PSK-CUR', amountKobo: 40305798 })
  }));

  await page.goto('/');
  await page.locator('.product-card').first().getByRole('button', { name: 'Add to bag' }).click();
  await page.locator('[data-tab="cart"]').click();
  await page.locator('#checkoutTriggerBtn').click();
  // This spec exercises the CARD path (it stubs Paystack), and pay on delivery is
  // now the default, so choose card explicitly.
  await page.locator('.pay-card-pill[data-payment="Card"]').click();
  await page.locator('#checkoutName').fill('Ada Customer');
  await page.locator('#checkoutAddress').fill('1 Main Street');
  await page.locator('#checkoutCity').fill('Port Harcourt');
  await page.locator('#checkoutEmail').fill('ada@example.com');
  await page.locator('#confirmPayBtn').click();
  await expect(page.locator('#orderSuccessScreen')).toBeVisible();

  // The charge was requested in the viewed currency, in its minor unit:
  // $299 at the pinned rate is ₦403,057.98, i.e. 40,305,798 kobo.
  expect(await page.evaluate(() => window.__currency)).toBe('NGN');
  expect(await page.evaluate(() => window.__amount)).toBe(40305798);

  // The order itself is still recorded against the same dollar value, so a
  // later rate change cannot rewrite what the customer bought.
  const totals = await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('greencart_store_v1'));
    return { total: raw.orders[0].total, subtotal: raw.orders[0].subtotal };
  });
  expect(totals.subtotal).toBe(299);
  expect(totals.total).toBe(299);
});

test('the footer reaches every legal page and each renders without errors', async ({ page }) => {
  // Card networks require a reachable returns policy, privacy notice and
  // contact route. A link that 404s is the same as no link, and only a real
  // browser navigation proves the file is served at that path.
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.goto('/');

  const footer = page.locator('.footer-links');
  await expect(footer).toBeVisible();
  const links = await footer.getByRole('link').allTextContents();
  expect(links).toEqual(['Delivery & returns', 'Privacy', 'Terms', 'Contact']);

  for (const name of links) {
    await page.goto('/');
    await page.locator('.footer-links').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(/\/legal\//);
    await expect(page.locator('.legal-page h1')).toBeVisible();
    // The page must warn that its details are placeholders, not look finished.
    await expect(page.locator('[data-contact-warning]')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a legal page shows real contact details once they are filled in', async ({ page }) => {
  await page.route('**/js/contact.js', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.GREENCART_CONTACT={businessName:"GreenCart Ltd",addressLine:"12 Aba Road",city:"Port Harcourt",state:"Rivers State",country:"Nigeria",email:"help@shopgreencart.com",whatsapp:"2348030000000",hours:"Mon-Sat"};window.GREENCART_CONTACT_MISSING=()=>[];'
  }));
  await page.goto('/legal/contact.html');
  await expect(page.locator('[data-contact-warning]')).toBeHidden();
  await expect(page.getByRole('link', { name: 'help@shopgreencart.com' })).toBeVisible();
  await expect(page.getByRole('link', { name: '+234 803 000 0000' })).toBeVisible();
});
