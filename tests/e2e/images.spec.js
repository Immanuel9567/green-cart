const { test, expect } = require('@playwright/test');

test('uploaded product images survive editing and can be removed', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { window.localStorage.setItem('greencart_currency_v1', 'USD'); } catch (_) { } });
  await page.goto('/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('#addProductBtn').click();
  await page.locator('#productName').fill('Uploaded object');
  await page.locator('#productPrice').fill('30');
  await page.locator('#productStock').fill('3');
  await page.locator('#productDescription').fill('An object with an uploaded image.');
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2p0AAAAASUVORK5CYII=', 'base64');
  await page.locator('#productImageFile').setInputFiles({ name: 'object.png', mimeType: 'image/png', buffer: image });
  await page.locator('#adminProductForm button[type="submit"]').click();
  // The products table is paged, so find the new row through search instead of
  // assuming it lands on the visible page.
  await page.locator('#adminProductSearch').fill('Uploaded object');
  let row = page.locator('#adminProductBody tr').filter({ hasText: 'Uploaded object' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('#productImage')).toHaveValue('');
  await page.locator('#productName').fill('Edited object');
  await page.locator('#adminProductForm button[type="submit"]').click();
  await page.locator('#adminProductSearch').fill('Edited object');
  await page.locator('#adminProductBody tr').filter({ hasText: 'Edited object' }).waitFor();
  await page.locator('#adminCloseBtn').click();
  await page.locator('#searchInput').fill('Edited object');
  await expect(page.locator('.product-card img')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await page.reload();
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('#adminProductSearch').fill('Edited object');
  row = page.locator('#adminProductBody tr').filter({ hasText: 'Edited object' });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#productRemoveImage').check();
  await page.locator('#adminProductForm button[type="submit"]').click();
  await page.locator('#adminCloseBtn').click();
  await page.locator('#searchInput').fill('Edited object');
  await expect(page.locator('.product-card img')).toHaveAttribute('src', /^data:image\/svg\+xml,/);
});

test('inventory edits update the low-stock alert and product availability', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { window.localStorage.setItem('greencart_currency_v1', 'USD'); } catch (_) { } });
  await page.goto('/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="inventory"]').click();
  const row = page.locator('#adminInventoryBody tr').filter({ hasText: 'AURA ANC Over-Ear' });
  await row.locator('input').fill('2');
  await row.getByRole('button', { name: 'Save stock' }).click();
  await expect(row).toContainText('Low stock');
  await page.locator('[data-admin="analytics"]').click();
  await expect(page.locator('#analyticsLowStock')).toHaveText('1');
  await page.locator('[data-admin="inventory"]').click();
  await row.locator('input').fill('0');
  await row.getByRole('button', { name: 'Save stock' }).click();
  await expect(row).toContainText('Out of stock');
  await page.locator('#adminCloseBtn').click();
  const first = page.locator('.product-card').first();
  await expect(first.getByRole('button', { name: 'Out of stock' })).toBeDisabled();
});

test('fixed-amount sales apply automatically and can be disabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { window.localStorage.setItem('greencart_currency_v1', 'USD'); } catch (_) { } });
  await page.goto('/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="discounts"]').click();
  await page.locator('#addPromoBtn').click();
  await page.locator('#promoCode').fill('AUTOSALE');
  await page.locator('#promoType').selectOption('amount');
  await expect(page.locator('#promoValueLabel')).toHaveText('Discount (USD)');
  await page.locator('#promoPercent').fill('20.50');
  await page.locator('#promoAutomatic').check();
  await page.locator('#adminPromoForm button[type="submit"]').click();
  const row = page.locator('#adminPromoBody tr').filter({ hasText: 'AUTOSALE' });
  await expect(row).toContainText('$20.50 off');
  await expect(row).toContainText('Automatic sale');
  await page.locator('#adminCloseBtn').click();
  await page.locator('.product-card').first().getByRole('button', { name: 'Add to bag' }).click();
  await page.locator('[data-tab="cart"]').click();
  await expect(page.locator('#cartDiscount')).toContainText('$20.50');
  await expect(page.locator('#cartTotal')).toHaveText('$278.50');
  await expect(page.locator('#promoInput')).toHaveValue('');
  await page.locator('#cartCloseBtn').click();
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="discounts"]').click();
  await row.getByRole('button', { name: 'Disable' }).click();
  await page.locator('#adminCloseBtn').click();
  await page.locator('[data-tab="cart"]').click();
  await expect(page.locator('#cartDiscountRow')).toBeHidden();
  await expect(page.locator('#cartTotal')).toHaveText('$299.00');
});

test('archiving a product retires it from the storefront and keeps it restorable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { window.localStorage.setItem('greencart_currency_v1', 'USD'); } catch (_) { } });
  await page.goto('/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();

  // Archive the featured product, which is also the hero.
  const row = page.locator('#adminProductBody tr').filter({ hasText: 'AURA ANC Over-Ear' });
  await row.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('#confirmMessage')).toContainText('Past orders keep their details');
  await page.locator('#confirmAccept').click();
  await expect(page.locator('#toastContainer')).toContainText('Product archived');
  await expect(page.locator('#adminProductBody')).not.toContainText('AURA ANC Over-Ear');

  // The archived filter shows it with Restore, and permanent delete only appears there.
  await page.locator('[data-product-filter="archived"]').click();
  const archivedRow = page.locator('#adminProductBody tr').filter({ hasText: 'AURA ANC Over-Ear' });
  await expect(archivedRow).toContainText('Archived');
  await expect(archivedRow.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
  await page.locator('#adminCloseBtn').click();

  // Storefront no longer lists it, and its old URL says it is retired.
  await expect(page.locator('#productGrid a[data-product-link="aura-01"]')).toHaveCount(0);
  await expect(page.locator('#resultsCount')).toContainText('Showing 13 objects');
  await page.goto('/?admin=1&product=aura-01');
  await expect(page.locator('#productPageContent')).toContainText('No longer available');
  await expect(page.locator('#productPageContent')).not.toContainText('Product not found');
  await expect(page.locator('#productAddToCart')).toHaveCount(0);

  // Restore and confirm it returns with stock intact.
  await page.goto('/?admin=1');
  await page.locator('[data-tab="admin"]').click();
  await page.locator('[data-admin="products"]').click();
  await page.locator('[data-product-filter="archived"]').click();
  await page.locator('#adminProductBody tr').filter({ hasText: 'AURA ANC Over-Ear' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('#toastContainer')).toContainText('Product restored');
  await page.locator('[data-product-filter="active"]').click();
  await expect(page.locator('#adminProductBody')).toContainText('AURA ANC Over-Ear');
  await page.locator('#adminCloseBtn').click();
  await expect(page.locator('#resultsCount')).toContainText('Showing 14 objects');
});
