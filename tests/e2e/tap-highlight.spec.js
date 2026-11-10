const { test, expect } = require('@playwright/test');

async function load(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('https://images.unsplash.com/**', route => route.abort());
  await page.goto('/');
}

// The admin is out of the public nav; these checks reach it with ?admin=1.
async function loadAdmin(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?admin=1');
}

test.describe('mobile touch feedback', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('removes the browser tap highlight across the storefront and admin', async ({ page }) => {
    await load(page);
    for (const selector of [
      'html', 'body', '#themeToggleBtn', '#searchInput', '.hero-product-link', '.site-nav-link',
      '.cat-pill', '.product-img-frame', '.product-img-frame img', '#cartCloseBtn', '.admin-form input'
    ]) {
      await expect(page.locator(selector).first()).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
    }
    await page.locator('[data-tab="shop"]').tap();
    await expect(page.locator('[data-tab="shop"]')).toHaveAttribute('aria-current', 'page');
    await page.locator('.product-card').first().getByRole('button', { name: 'Add to bag' }).tap();
    await expect(page.locator('#navCartBadge')).toHaveText('1');
    await page.locator('[data-tab="cart"]').tap();
    await expect(page.locator('#cartDrawer')).toHaveClass(/open/);
    await page.locator('#cartCloseBtn').tap();
    await page.locator('[data-tab="shop"]').tap();
    await page.goto('/?admin=1');
    await page.locator('[data-tab="admin"]').tap();
    await expect(page.locator('#adminModal')).toHaveClass(/open/);
    await page.locator('#adminCloseBtn').tap();
    await page.locator('.hero-product-link').tap();
    await expect(page.locator('#productPage')).toBeVisible();
    for (const selector of ['.product-back-link', '.color-swatch', '.size-pill', '#productSaveBtn', '#productAddToCart']) {
      await expect(page.locator(selector).first()).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
    }
    await page.locator('.color-swatch').nth(1).tap();
    await expect(page.locator('.color-swatch').nth(1)).toHaveAttribute('aria-pressed', 'true');
  });
});

test('mouse clicks do not show an outline and keyboard focus remains visible', async ({ page }) => {
  await load(page);
  const theme = page.locator('#themeToggleBtn');
  await theme.click();
  await expect(theme).not.toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Tab');
  const home = page.locator('[data-tab="home"]');
  await expect(home).toBeFocused();
  await expect(home).toHaveCSS('outline-style', 'solid');
  await expect(home).toHaveCSS('outline-width', '2px');
  await expect(home).toHaveCSS('outline-color', 'rgb(246, 247, 249)');
});
