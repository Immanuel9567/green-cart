const AppStore = new Store(window.STORE_DATA.products, window.localStorage);
const $ = id => document.getElementById(id);
const DOM = {
  storefrontView: $('storefrontView'), productPage: $('productPage'), productPageContent: $('productPageContent'),
  productGrid: $('productGrid'), resultsCount: $('resultsCount'), searchInput: $('searchInput'), searchClearBtn: $('searchClearBtn'),
  navTabs: document.querySelectorAll('.site-nav-link'), navCartBadge: $('navCartBadge'), categoryPills: document.querySelectorAll('.cat-pill'),
  overlay: $('overlay'), cartDrawer: $('cartDrawer'), cartItemsList: $('cartItemsList'), drawerCount: $('drawerCount'),
  cartSubtotal: $('cartSubtotal'), cartDiscount: $('cartDiscount'), cartDiscountRow: $('cartDiscountRow'), cartShipping: $('cartShipping'), cartTotal: $('cartTotal'),
  promoInput: $('promoInput'), checkoutTriggerBtn: $('checkoutTriggerBtn'),
  wishlistModal: $('wishlistModal'), wishlistItemsList: $('wishlistItemsList'), checkoutModal: $('checkoutModal'), checkoutForm: $('checkoutForm'),
  orderSuccessScreen: $('orderSuccessScreen'), orderTrackingNum: $('orderTrackingNum'), profileModal: $('profileModal'), profileOrders: $('profileOrders'),
  adminModal: $('adminModal'), toastContainer: $('toastContainer'), themeNotice: $('themeNotice'), themeToggleBtn: $('themeToggleBtn'), themeToggleLabel: $('themeToggleLabel')
};

// All money on screen goes through the currency layer, so the USD -> NGN choice
// applies everywhere at once and nowhere formats a price on its own. Prices are
// stored in USD; only the rendering changes.
const money = value => window.GreenCartCurrency.format(value);
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const titleCase = value => String(value || '').replace(/\b\w/g, char => char.toUpperCase());
const formatDate = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

function safeColor(color) {
  return /^#[0-9a-f]{3,8}$/i.test(String(color)) ? color : '#111215';
}

function validImageSource(value) {
  if (!value) return true;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch (_) { return false; }
  }
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) && !/[<>\s]/.test(value);
}

function getCategorySvg(category) {
  const shape = {
    audio: '<path d="M54 110a46 46 0 0 1 92 0v32a12 12 0 0 1-12 12h-10a12 12 0 0 1-12-12v-20a12 12 0 0 1 12-12h10a34 34 0 0 0-68 0h10a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H66a12 12 0 0 1-12-12z"/>',
    timepieces: '<rect x="84" y="20" width="32" height="160" rx="9"/><circle cx="100" cy="100" r="48"/><circle cx="100" cy="100" r="35" fill="#e6ecf4"/><path d="M100 76v24l18 10" stroke="#111215" stroke-width="5" fill="none"/>',
    footwear: '<path d="M35 130c28 0 40-13 58-26 22-15 44-13 69 9 6 5 7 13 5 19v10H35z"/>',
    living: '<path d="M66 60h68v85a14 14 0 0 1-14 14H80a14 14 0 0 1-14-14z"/><circle cx="100" cy="40" r="8"/>',
    tech: '<rect x="38" y="61" width="124" height="78" rx="12"/><path d="M55 80h90M55 98h90M70 117h60" stroke="#e6ecf4" stroke-width="7" stroke-linecap="round"/>'
  }[category] || '';
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" rx="26" fill="#e6ecf4"/><g fill="#22252a">${shape}</g></svg>`);
}

function imageSource(product) {
  const source = String(product.image || '').trim();
  return source && validImageSource(source) ? source : getCategorySvg(product.category);
}

function productImage(product, className) {
  return `<img src="${escapeHtml(imageSource(product))}" alt="${escapeHtml(product.title)}" class="${className}" data-fallback-category="${escapeHtml(product.category || 'audio')}" loading="lazy">`;
}

function productHref(productId) {
  return `?product=${encodeURIComponent(productId)}`;
}

function productLinkAttributes(product) {
  return `href="${escapeHtml(productHref(product.id))}" data-product-link="${escapeHtml(product.id)}"`;
}

function productRouteId() {
  return new URLSearchParams(window.location.search).get('product');
}

function isProductRoute() {
  return new URLSearchParams(window.location.search).has('product');
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' toast-error' : ''}`;
  toast.textContent = message;
  DOM.toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

let themeNoticeTimer;

function showThemeNotice(isDark) {
  clearTimeout(themeNoticeTimer);
  DOM.themeNotice.textContent = isDark ? 'Dark mode enabled' : 'Light mode enabled';
  DOM.themeNotice.classList.add('visible');
  themeNoticeTimer = setTimeout(() => DOM.themeNotice.classList.remove('visible'), 2600);
}

function attempt(action) {
  try { return action(); } catch (error) { showToast(error.message || 'Something went wrong.', true); return null; }
}

function getFilteredProducts() {
  let products = [...AppStore.availableProducts];
  if (AppStore.activeCategory !== 'all') products = products.filter(product => product.category === AppStore.activeCategory);
  const query = AppStore.searchQuery.trim().toLowerCase();
  if (query) products = products.filter(product => [product.title, product.description, product.categoryName, ...(product.tags || [])].some(value => String(value).toLowerCase().includes(query)));
  if (AppStore.sortBy === 'price-low') products.sort((a, b) => a.price - b.price);
  if (AppStore.sortBy === 'price-high') products.sort((a, b) => b.price - a.price);
  if (AppStore.sortBy === 'rating') products.sort((a, b) => b.rating - a.rating);
  return products;
}

function renderProductGrid() {
  const featured = AppStore.availableProducts.find(product => product.id === 'aura-01') || AppStore.availableProducts[0];
  $('featuredHero').hidden = !featured;
  if (featured) {
    $('featuredPrice').textContent = money(featured.price);
    $('featuredCurrency').textContent = GreenCartCurrency.get();
    $('featuredProductLink').setAttribute('aria-label', `View ${featured.title}`);
    const image = $('featuredProductImage');
    const source = imageSource(featured);
    image.alt = featured.title;
    [image, $('featuredProductBackdrop')].forEach(element => {
      element.dataset.fallbackCategory = featured.category;
      if (element.dataset.originalSource !== source) {
        element.dataset.originalSource = source;
        delete element.dataset.fallbackUsed;
        element.src = source;
      }
    });
  }
  const products = getFilteredProducts();
  DOM.resultsCount.textContent = `Showing ${products.length} ${products.length === 1 ? 'object' : 'objects'}`;
  if (!products.length) {
    DOM.productGrid.innerHTML = `<div class="empty-state"><div class="section-kicker">THE COLLECTION</div><h2>No objects found.</h2><p>There are no products matching your search.</p><button type="button" class="nm-btn" id="resetFilterBtn">Reset filters</button></div>`;
    $('resetFilterBtn').addEventListener('click', () => {
      AppStore.searchQuery = '';
      AppStore.activeCategory = 'all';
      DOM.searchInput.value = '';
      DOM.searchClearBtn.classList.remove('visible');
      updateCategories();
      renderProductGrid();
    });
    return;
  }
  DOM.productGrid.innerHTML = products.map(product => {
    const saved = AppStore.isWishlisted(product.id);
    const remaining = product.stock - AppStore.quantityInCart(product.id);
    const unavailable = product.stock === 0;
    const id = escapeHtml(product.id);
    return `<article class="product-card" data-id="${id}">
      <div class="card-top"><span class="card-tag">${escapeHtml(unavailable ? 'Out of stock' : (product.badge || 'Collection'))}</span>
        <button type="button" class="wishlist-btn${saved ? ' active' : ''}" data-action="wishlist" data-id="${id}" aria-pressed="${saved}" aria-label="${saved ? 'Remove' : 'Save'} ${escapeHtml(product.title)} ${saved ? 'from' : 'to'} wishlist"><span aria-hidden="true">${saved ? '♥' : '♡'}</span> ${saved ? 'Saved' : 'Save'}</button></div>
      <a class="product-img-frame" ${productLinkAttributes(product)} aria-label="View ${escapeHtml(product.title)}">${productImage(product, 'product-thumb')}</a>
      <div class="product-category">${escapeHtml(product.categoryName)}</div>
      <h2><a class="product-title" ${productLinkAttributes(product)}>${escapeHtml(product.title)}</a></h2>
      <div class="product-rating">${product.rating ? `<span class="stars" aria-hidden="true">★★★★★</span><span><strong>${escapeHtml(product.rating)}</strong></span><span class="rating-count">(${escapeHtml(product.reviewsCount)})</span>` : '<span class="rating-count">New arrival</span>'}</div>
      <div class="card-bottom"><div class="product-price">${product.originalPrice && product.originalPrice > product.price ? `<span class="price-original">${money(product.originalPrice)}</span>` : ''}<span class="price-current">${money(product.price)}</span></div>
        <button type="button" class="add-cart-btn" data-action="add-cart" data-id="${id}" ${remaining <= 0 ? 'disabled' : ''}>${unavailable ? 'Out of stock' : remaining <= 0 ? 'In your bag' : 'Add to bag'}</button></div>
    </article>`;
  }).join('');
}

function updateCategories() {
  DOM.categoryPills.forEach(pill => {
    const active = pill.dataset.category === AppStore.activeCategory;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
}

function updateBadges() {
  const count = AppStore.getCartCount();
  DOM.navCartBadge.textContent = count;
  const bag = document.querySelector('[data-tab="cart"]');
  bag.setAttribute('aria-label', `Bag, ${count} ${count === 1 ? 'item' : 'items'}`);
  DOM.drawerCount.textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
}

function renderCartDrawer() {
  updateBadges();
  if (!AppStore.cart.length) {
    DOM.cartItemsList.innerHTML = `<div class="cart-empty"><div class="empty-circle" aria-hidden="true">○</div><h3>Your bag is empty.</h3><p>Find something made for your everyday.</p></div>`;
  } else {
    DOM.cartItemsList.innerHTML = AppStore.cart.map((item, index) => {
      const product = AppStore.availableProducts.find(p => p.id === item.id);
      if (!product) return '';
      return `<div class="cart-item">
        <a class="cart-item-img-well" ${productLinkAttributes(product)} aria-label="View ${escapeHtml(product.title)}">${productImage(product, 'cart-item-img')}</a>
        <div class="cart-item-details"><h3 class="cart-item-title"><a ${productLinkAttributes(product)}>${escapeHtml(product.title)}</a></h3><div class="cart-item-meta">${escapeHtml(item.selectedSize)} <span aria-hidden="true">·</span> <span class="color-dot" style="background:${safeColor(item.selectedColor)}" aria-hidden="true"></span> ${escapeHtml(item.selectedColor)}</div><div class="cart-item-price">${money(product.price)}</div></div>
        <div class="cart-item-actions"><div class="qty-stepper" aria-label="Quantity"><button type="button" class="qty-btn" data-action="qty-minus" data-index="${index}" aria-label="Decrease quantity of ${escapeHtml(product.title)}">Decrease</button><span class="qty-value">${item.quantity}</span><button type="button" class="qty-btn" data-action="qty-plus" data-index="${index}" aria-label="Increase quantity of ${escapeHtml(product.title)}">Increase</button></div><button type="button" class="text-action danger-text" data-action="remove-cart" data-index="${index}" aria-label="Remove ${escapeHtml(product.title)} from bag">Remove</button></div>
      </div>`;
    }).join('');
  }
  DOM.checkoutTriggerBtn.disabled = !AppStore.cart.length;
  const totals = AppStore.getCartTotals();
  DOM.cartSubtotal.textContent = money(totals.subtotal);
  DOM.cartShipping.textContent = totals.shipping ? money(totals.shipping) : 'Free';
  DOM.cartTotal.textContent = money(totals.total);
  DOM.cartDiscountRow.hidden = !totals.promotion;
  $('promoRemoveBtn').hidden = !totals.promotion || totals.promotion.code !== AppStore.state.appliedPromo;
  if (totals.promotion) DOM.cartDiscount.textContent = `−${money(totals.discount)} (${totals.promotion.code})`;
  DOM.promoInput.value = totals.promotion && totals.promotion.code === AppStore.state.appliedPromo ? totals.promotion.code : '';
}

let productSelection = { id: null, color: null, size: null, quantity: 1 };

function updateProductSaved() {
  const button = $('productSaveBtn');
  if (!button || !isProductRoute()) return;
  const saved = AppStore.isWishlisted(productRouteId());
  button.classList.toggle('active', saved);
  button.setAttribute('aria-pressed', String(saved));
  button.innerHTML = `<span aria-hidden="true">${saved ? '♥' : '♡'}</span> ${saved ? 'Saved' : 'Save'}`;
}

function updateProductAvailability() {
  if (!isProductRoute()) return;
  const product = AppStore.availableProducts.find(item => item.id === productRouteId());
  const addButton = $('productAddToCart');
  if (!product || !addButton) return;
  const available = Math.max(0, product.stock - AppStore.quantityInCart(product.id));
  productSelection.quantity = Math.min(Math.max(1, productSelection.quantity), Math.max(1, available));
  $('productQtyValue').textContent = productSelection.quantity;
  $('productQtyMinus').disabled = productSelection.quantity <= 1;
  $('productQtyPlus').disabled = productSelection.quantity >= available;
  addButton.disabled = available === 0;
  addButton.textContent = available ? `Add to bag · ${money(product.price * productSelection.quantity)}` : product.stock ? 'In your bag' : 'Out of stock';
  $('productStockNote').textContent = available ? 'In stock' : product.stock ? 'All available units are already in your bag.' : 'Currently out of stock.';
}

function renderProductPage(productId) {
  const focused = DOM.productPageContent.contains(document.activeElement) ? document.activeElement : null;
  const focusId = focused && focused.id;
  const focusColor = focused && focused.dataset.color;
  const focusSize = focused && focused.dataset.size;
  const product = AppStore.products.find(item => item.id === productId);
  if (product && product.archived) {
    document.title = "No longer available | GreenCart";
    DOM.productPageContent.innerHTML = `<div class="product-missing"><div class="section-kicker">THE COLLECTION</div><h1 id="productPageTitle" tabindex="-1">No longer available<span class="brand-dot">.</span></h1><p>${escapeHtml(product.title)} has been retired and is not for sale. Past orders that included it keep their details in your account.</p><a class="nm-btn" href="./#catalogSection" data-storefront-link="shop">Back to the collection</a></div>`;
  } else if (!product) {
    document.title = "Product not found | GreenCart";
    DOM.productPageContent.innerHTML = `<div class="product-missing"><div class="section-kicker">THE COLLECTION</div><h1 id="productPageTitle" tabindex="-1">Product not found<span class="brand-dot">.</span></h1><p>This item may no longer be available on this device.</p></div>`;
  } else {
    if (productSelection.id !== product.id) productSelection = { id: product.id, color: product.colors[0], size: product.sizes[0], quantity: 1 };
    if (!product.colors.includes(productSelection.color)) productSelection.color = product.colors[0];
    if (!product.sizes.includes(productSelection.size)) productSelection.size = product.sizes[0];
    const saved = AppStore.isWishlisted(product.id);
    const specs = Array.isArray(product.specs) ? product.specs.filter(spec => spec && spec.label != null && spec.value != null && String(spec.label).trim() && String(spec.value).trim()) : [];
    document.title = `${product.title} | GreenCart`;
    DOM.productPageContent.innerHTML = `<article class="product-detail-card">
      <div class="product-detail-img-well">${productImage(product, 'product-detail-img')}</div>
      <div class="product-detail-body">
        <div><div class="section-kicker">${escapeHtml(product.categoryName)}</div><h1 class="product-detail-title" id="productPageTitle" tabindex="-1">${escapeHtml(product.title)}</h1>
          <div class="product-rating product-detail-rating">${product.rating ? `<span class="stars" aria-hidden="true">★★★★★</span><span><strong>${escapeHtml(product.rating)}</strong> / 5</span><span class="rating-count">(${escapeHtml(product.reviewsCount)} reviews)</span>` : '<span class="rating-count">New arrival</span>'}</div></div>
        <div class="product-detail-price-row"><span class="product-detail-price">${money(product.price)}</span>${product.originalPrice && product.originalPrice > product.price ? `<span class="price-original">${money(product.originalPrice)}</span>` : ''}</div>
        <p class="product-detail-desc">${escapeHtml(product.description)}</p>
        <div><div class="product-option-label" id="productColorLabel">Finish</div><div class="swatch-group" id="productColorSwatches" role="group" aria-labelledby="productColorLabel">${product.colors.map(color => `<button type="button" class="color-swatch${color === productSelection.color ? ' active' : ''}" data-color="${escapeHtml(color)}" aria-pressed="${color === productSelection.color}"><span class="color-dot" style="background:${safeColor(color)}" aria-hidden="true"></span>${escapeHtml(color)}</button>`).join('')}</div></div>
        <div><div class="product-option-label" id="productSizeLabel">Size / specification</div><div class="swatch-group" id="productSizePills" role="group" aria-labelledby="productSizeLabel">${product.sizes.map(size => `<button type="button" class="size-pill${size === productSelection.size ? ' active' : ''}" data-size="${escapeHtml(size)}" aria-pressed="${size === productSelection.size}">${escapeHtml(size)}</button>`).join('')}</div></div>
        <div class="product-selection-actions"><div class="qty-stepper" role="group" aria-label="Quantity"><button type="button" class="qty-btn" id="productQtyMinus">Decrease</button><span class="qty-value" id="productQtyValue" aria-live="polite">1</span><button type="button" class="qty-btn" id="productQtyPlus">Increase</button></div><button type="button" class="wishlist-btn${saved ? ' active' : ''}" id="productSaveBtn" aria-pressed="${saved}"><span aria-hidden="true">${saved ? '♥' : '♡'}</span> ${saved ? 'Saved' : 'Save'}</button></div>
        <button type="button" class="checkout-btn" id="productAddToCart"></button><p class="product-stock-note" id="productStockNote"></p>
        ${specs.length ? `<section class="product-specs" aria-labelledby="productSpecsHeading"><h2 id="productSpecsHeading">Specifications</h2><dl>${specs.map(spec => `<div><dt>${escapeHtml(spec.label)}</dt><dd>${escapeHtml(spec.value)}</dd></div>`).join('')}</dl></section>` : ''}
      </div>
    </article>`;
    updateProductAvailability();
  }
  let replacement = focusId ? $(focusId) : null;
  if (!replacement && focusColor != null) replacement = Array.from(DOM.productPageContent.querySelectorAll('[data-color]')).find(button => button.dataset.color === focusColor);
  if (!replacement && focusSize != null) replacement = Array.from(DOM.productPageContent.querySelectorAll('[data-size]')).find(button => button.dataset.size === focusSize);
  if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
  else if (focused) $('productPageTitle').focus({ preventScroll: true });
}

function renderRoute() {
  const viewingProduct = isProductRoute();
  DOM.storefrontView.hidden = viewingProduct;
  DOM.productPage.hidden = !viewingProduct;
  $('brandLogo').setAttribute('href', viewingProduct ? './' : '#home');
  if (viewingProduct) renderProductPage(productRouteId());
  else document.title = "GreenCart | Everyday essentials, considered";
  setActiveNav(viewingProduct || window.location.hash === '#catalogSection' ? 'shop' : 'home');
}

function openProductPage(productId) {
  closeAllModals();
  if (!isProductRoute() || productRouteId() !== productId) window.history.pushState({}, '', productHref(productId));
  renderRoute();
  window.scrollTo({ top: 0, behavior: 'instant' });
  $('productPageTitle').focus({ preventScroll: true });
}

function goToStorefront(target = 'home', focusCollection = false) {
  closeAllModals();
  if (isProductRoute()) {
    const url = new URL(window.location.href);
    url.searchParams.delete('product');
    url.hash = target === 'shop' ? 'catalogSection' : 'home';
    window.history.pushState({}, '', url);
    renderRoute();
  }
  setActiveNav(target);
  if (target === 'shop') $('catalogSection').scrollIntoView({ behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
  if (focusCollection) $('collectionTitle').focus({ preventScroll: true });
}

function renderWishlistModal() {
  const items = AppStore.state.wishlist.map(id => AppStore.availableProducts.find(product => product.id === id)).filter(Boolean);
  DOM.wishlistItemsList.innerHTML = items.length ? items.map(product => `<div class="saved-item"><a class="cart-item-img-well" ${productLinkAttributes(product)} aria-label="View ${escapeHtml(product.title)}">${productImage(product, 'cart-item-img')}</a><div class="cart-item-details"><h3 class="cart-item-title"><a ${productLinkAttributes(product)}>${escapeHtml(product.title)}</a></h3><div class="cart-item-price">${money(product.price)}</div></div><div class="saved-actions"><button type="button" class="nm-btn compact" data-action="wishlist-to-cart" data-id="${escapeHtml(product.id)}" ${product.stock - AppStore.quantityInCart(product.id) <= 0 ? 'disabled' : ''}>Add to bag</button><button type="button" class="text-action danger-text" data-action="remove-wishlist" data-id="${escapeHtml(product.id)}">Remove</button></div></div>`).join('') : `<div class="list-empty"><h3>Nothing saved yet.</h3><p>Your saved objects will appear here.</p></div>`;
}

function renderProfile() {
  DOM.profileOrders.innerHTML = AppStore.orders.length ? AppStore.orders.map(order => {
    const count = (order.items || []).reduce((sum, item) => sum + item.quantity, 0);
    const names = (order.items || []).map(item => item.title).join(', ');
    return `<article class="profile-order"><div class="profile-order-top"><div><span class="profile-reference">${escapeHtml(order.reference)}</span><div class="profile-order-meta">${escapeHtml(formatDate(order.createdAt))} · ${count} ${count === 1 ? 'item' : 'items'}</div></div><span class="admin-status-badge status-${escapeHtml(order.status)}">${escapeHtml(titleCase(order.status))}</span></div><div class="profile-order-bottom"><span>${escapeHtml(names)}</span><strong>${money(order.total)}</strong></div></article>`;
  }).join('') : `<div class="list-empty"><h3>No orders yet.</h3><p>Your order references will appear here.</p></div>`;
}

let activeLayer = null;
let previousFocus = null;
let pageScrollY = 0;

function lockPage() {
  if (document.body.classList.contains('scroll-locked')) return;
  pageScrollY = window.scrollY;
  document.body.style.top = `-${pageScrollY}px`;
  document.body.classList.add('scroll-locked');
}

function unlockPage() {
  if (!document.body.classList.contains('scroll-locked')) return;
  document.body.classList.remove('scroll-locked');
  document.body.style.top = '';
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  window.scrollTo(0, pageScrollY);
  document.documentElement.style.scrollBehavior = previousBehavior;
}

function setActiveNav(tabId) {
  DOM.navTabs.forEach(tab => {
    const active = tab.dataset.tab === tabId;
    tab.classList.toggle('active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
}

function openLayer(layer) {
  DOM.toastContainer.replaceChildren();
  if (!activeLayer) previousFocus = document.activeElement;
  if (activeLayer) { activeLayer.classList.remove('open'); activeLayer.setAttribute('aria-hidden', 'true'); }
  activeLayer = layer;
  lockPage();
  DOM.overlay.classList.add('open');
  layer.classList.add('open');
  layer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => layer.focus({ preventScroll: true }));
}

function closeAllModals() {
  if (!activeLayer) return;
  activeLayer.classList.remove('open');
  activeLayer.setAttribute('aria-hidden', 'true');
  activeLayer = null;
  DOM.overlay.classList.remove('open');
  unlockPage();
  setActiveNav(isProductRoute() || window.location.hash === '#catalogSection' ? 'shop' : 'home');
  if (previousFocus && previousFocus.isConnected && !previousFocus.disabled) previousFocus.focus({ preventScroll: true });
  else if (isProductRoute()) {
    const fallback = $('productSaveBtn') || $('productPageTitle');
    if (fallback) fallback.focus({ preventScroll: true });
  }
  previousFocus = null;
}

function selectPayment(button) {
  document.querySelectorAll('.pay-card-pill').forEach(item => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    item.setAttribute('aria-checked', String(selected));
    item.tabIndex = selected ? 0 : -1;
  });
}

// Show the recovery notice when saved data existed but could not be read. The
// message says plainly that what follows is seed data, because the alternative
// is a shop that looks fine while silently missing the customer's orders.
function renderAdminRecovery() {
  const banner = $('adminRecovery');
  if (!banner) return;
  const recovery = AppStore.recovery;
  if (!recovery || recovery.dismissed) { banner.hidden = true; return; }
  banner.hidden = false;
  $('adminRecoveryDetail').textContent = `The catalogue and orders below are the built-in defaults, not your saved data (${recovery.bytes} bytes stored). Nothing has been overwritten yet: saving any change will replace it.`;
}

function renderAdminPanel() {
  renderAdminRecovery();
  renderAdminAnalytics();
  renderAdminProducts();
  renderAdminOrders();
  renderAdminInventory();
  renderAdminCustomers();
  renderAdminDiscounts();
}

// The five admin lists differ only in how they filter and how they draw a row.
// Everything else - syncing the filter pills, remembering the matching items,
// paginating, choosing the empty message, counting columns for it, and drawing
// the pager - is the same, so it lives here once.
function syncFilterPills(selector, datasetKey, current) {
  document.querySelectorAll(selector).forEach(pill => {
    const active = pill.dataset[datasetKey] === current;
    pill.classList.toggle('active', active);
    pill.setAttribute('aria-pressed', String(active));
  });
}

// `emptyMessage` must be plain text: it is escaped here, once, so callers do
// not have to remember whether they escaped their own query already.
function renderAdminList({ state, bodyId, pagerId, items, row, emptyMessage, label, spokenLabel, syncPills, afterRender }) {
  if (syncPills) syncPills();
  state.items = items;
  const { items: pageItems, total } = paginate(items, state.page, ADMIN_PAGE_SIZE);
  const body = $(bodyId);
  if (total) {
    body.innerHTML = pageItems.map(row).join('');
  } else {
    // Read the column count from the table itself rather than hard-coding it
    // per list, where it silently drifts when a column is added.
    const columns = body.closest('table').querySelectorAll('thead th').length;
    body.innerHTML = `<tr><td colspan="${columns}" class="table-empty">${escapeHtml(emptyMessage)}</td></tr>`;
  }
  renderPager($(pagerId), state, label, spokenLabel);
  if (afterRender) afterRender();
}

function renderPager(container, state, label, spokenList = label) {
  if (!container) return;
  // Any re-render replaces these buttons, and the browser then drops focus to
  // <body>. That happens on a pager click *and* on anything else that rerenders
  // the list (archiving a product, saving stock, searching), so the pager
  // remembers whether it owned focus and takes it back afterwards.
  const focusedDelta = container.contains(document.activeElement)
    ? document.activeElement.dataset.pageDelta || null : undefined;
  const hadFocusInside = container.contains(document.activeElement);
  const { page, pageCount, total, start, items } = paginate(state.items, state.page, ADMIN_PAGE_SIZE);
  state.page = page;
  const first = total === 0 ? 0 : start + 1;
  const last = start + items.length;
  // With nothing to page, the table's own contextual empty message is the one
  // to read; a second "nothing here" line plus dead arrows is just noise.
  container.hidden = total === 0;
  if (total === 0) {
    container.innerHTML = '';
    // Clear rather than leave the previous list's range sitting in the live
    // region, where it would be read as if it described this list.
    announceListChange(state.key, '');
    return;
  }
  // tabindex="-1" so focus can be parked here when the control the reader used
  // becomes disabled, without adding another stop to the tab order. No
  // aria-live here: this element is destroyed on every render, so a live
  // region on it is created and changed in the same task and is not announced.
  // The persistent #adminListAnnouncer below does the announcing instead.
  const summary = `Showing ${first}\u2013${last} of ${total} ${spokenList}, page ${page} of ${pageCount}`;
  container.innerHTML = `<p class="admin-pager-status" tabindex="-1">${`Showing ${first}\u2013${last} of ${total} ${escapeHtml(label)}`}</p>
    <div class="admin-pager-controls">
      <button type="button" class="admin-page-btn" data-page-target="${escapeHtml(state.key)}" data-page-delta="-1" ${page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="admin-pager-page">Page ${page} of ${pageCount}</span>
      <button type="button" class="admin-page-btn" data-page-target="${escapeHtml(state.key)}" data-page-delta="1" ${page >= pageCount ? 'disabled' : ''}>Next</button>
    </div>`;
  announceListChange(state.key, total === 0 ? '' : summary);
  if (hadFocusInside) restorePagerFocus(container, focusedDelta);
}

// Announce page and result changes through one region that is never replaced.
// A repeated identical message is cleared first, because a live region that
// receives the same text twice usually announces nothing the second time.
let lastAnnouncement = '';
function announceListChange(key, message) {
  const announcer = $('adminListAnnouncer');
  if (!announcer) return;
  if (message === lastAnnouncement) {
    announcer.textContent = '';
    // Force a reflow so the identical text counts as a fresh change.
    void announcer.offsetWidth;
  }
  announcer.textContent = message;
  lastAnnouncement = message;
}

// Prefer the arrow the reader was using; if it is now disabled (end of list, or
// the list shrank under them), use the other arrow, then the status line.
function restorePagerFocus(container, delta) {
  const order = delta === '-1' ? ['-1', '1'] : ['1', '-1'];
  for (const value of order) {
    const button = container.querySelector(`[data-page-delta="${value}"]`);
    if (button && !button.disabled) { button.focus(); return; }
  }
  const status = container.querySelector('.admin-pager-status');
  if (status) status.focus();
}

let adminProductFilter = 'active';
let adminOrderFilter = 'all';
let adminInventoryFilter = 'all';
let adminPromoFilter = 'all';
const adminListState = {
  products: { key: 'products', query: '', page: 1 },
  orders: { key: 'orders', query: '', page: 1 },
  inventory: { key: 'inventory', query: '', page: 1 },
  customers: { key: 'customers', query: '', page: 1 },
  promotions: { key: 'promotions', query: '', page: 1 }
};

function productActions(product) {
  const id = escapeHtml(product.id);
  if (product.archived) {
    return `<div class="admin-actions"><button type="button" class="admin-action-btn" data-admin-action="restore-product" data-id="${id}">Restore</button><button type="button" class="admin-action-btn danger" data-admin-action="delete-product" data-id="${id}">Delete permanently</button></div>`;
  }
  return `<div class="admin-actions"><button type="button" class="admin-action-btn" data-admin-action="edit-product" data-id="${id}">Edit</button><button type="button" class="admin-action-btn" data-admin-action="archive-product" data-id="${id}">Archive</button></div>`;
}

function renderAdminProducts() {
  const state = adminListState.products;
  const all = AppStore.products;
  const matching = all.filter(product => adminProductFilter === 'all' ? true : adminProductFilter === 'archived' ? product.archived : !product.archived)
    .filter(product => matchesQuery(state.query, product.title, product.categoryName, (product.tags || []).join(' ')));
  renderAdminList({
    state,
    bodyId: 'adminProductBody',
    pagerId: 'adminProductPager',
    items: matching,
    label: 'products',
    spokenLabel: 'products in the catalogue',
    syncPills: () => syncFilterPills('[data-product-filter]', 'productFilter', adminProductFilter),
    row: product => `<tr${product.archived ? ' class="admin-row-archived"' : ''}>
    <td data-label="Product"><div><strong>${escapeHtml(product.title)}</strong><span class="admin-subline">${escapeHtml((product.tags || []).join(' · ') || product.id)}</span></div></td>
    <td data-label="Category">${escapeHtml(product.categoryName)}</td><td data-label="Price">${money(product.price)}</td><td data-label="Stock">${product.stock}</td>
    <td data-label="Status"><span class="admin-status-badge ${product.archived ? 'status-archived' : 'status-ok'}">${product.archived ? 'Archived' : 'Active'}</span></td>
    <td data-label="Actions">${productActions(product)}</td>
  </tr>`,
    emptyMessage: all.length === 0
      ? 'No products yet.'
      : state.query ? `No products match \u201c${state.query}\u201d.` : adminProductFilter === 'archived' ? 'No archived products.' : 'No active products yet.'
  });
}

function orderStatusControl(order) {
  if (order.status === 'refunded') return '<span class="admin-status-badge status-refunded">Refunded</span>';
  const next = nextOrderStatusesFor(order.status);
  // A terminal order has no legal next step: show its state instead of a dead dropdown.
  if (!next.length) return `<span class="admin-status-badge status-${escapeHtml(order.status)}">${escapeHtml(titleCase(order.status))}</span>`;
  return `<select class="admin-status-select" data-admin-action="order-status" data-reference="${escapeHtml(order.reference)}" aria-label="Status for ${escapeHtml(order.reference)}">${[order.status, ...next].map(status => `<option value="${escapeHtml(status)}" ${status === order.status ? 'selected' : ''}>${escapeHtml(titleCase(status))}</option>`).join('')}</select>`;
}

function refundAction(order) {
  if (!refundableStatuses.includes(order.status)) return '';
  return `<button type="button" class="admin-action-btn danger" data-admin-action="refund" data-reference="${escapeHtml(order.reference)}">Record refund</button>`;
}

function renderAdminOrders() {
  const state = adminListState.orders;
  const matching = AppStore.orders
    .filter(order => adminOrderFilter === 'all' || order.status === adminOrderFilter)
    .filter(order => matchesQuery(state.query, order.reference, order.customer.name, order.customer.email, titleCase(order.status), order.items.map(item => item.title).join(' ')));
  renderAdminList({
    state,
    bodyId: 'adminOrderBody',
    pagerId: 'adminOrderPager',
    items: matching,
    label: 'orders',
    syncPills: () => syncFilterPills('[data-order-filter]', 'orderFilter', adminOrderFilter),
    row: order => {
      const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
      return `<tr>
      <td data-label="Reference"><div><strong>${escapeHtml(order.reference)}</strong><span class="admin-subline">${escapeHtml(formatDate(order.createdAt))}</span></div></td>
      <td data-label="Customer"><div><strong>${escapeHtml(order.customer.name)}</strong><span class="admin-subline">${escapeHtml(order.customer.email)}</span></div></td>
      <td data-label="Items"><details class="order-items-details"><summary>${count} ${count === 1 ? 'item' : 'items'}</summary>${order.items.map(item => `<span>${escapeHtml(item.title)} × ${item.quantity}</span>`).join('')}</details></td>
      <td data-label="Total">${money(order.total)}</td>
      <td data-label="Status">${orderStatusControl(order)}</td>
      <td data-label="Actions"><div class="admin-actions"><button type="button" class="admin-action-btn" data-admin-action="order-details" data-reference="${escapeHtml(order.reference)}">View details</button>${refundAction(order)}</div></td>
    </tr>`;
    },
    emptyMessage: AppStore.orders.length === 0
      ? 'No orders yet.'
      : state.query ? `No orders match \u201c${state.query}\u201d.` : `No ${adminOrderFilter} orders.`,
    afterRender: () => {
      const details = $('orderDetails');
      if (!details.hidden && details.dataset.reference) renderOrderDetails(details.dataset.reference);
    }
  });
}

function renderOrderDetails(reference) {
  const order = AppStore.orders.find(item => item.reference === reference);
  const details = $('orderDetails');
  if (!order) { details.hidden = true; return; }
  details.dataset.reference = reference;
  details.hidden = false;
  details.innerHTML = `<div class="editor-heading"><h4>${escapeHtml(order.reference)}</h4><button type="button" class="text-action" data-admin-action="close-order-details">Close</button></div>
    <div class="customer-profile-grid"><div><span>Customer</span><strong>${escapeHtml(order.customer.name)}</strong><small>${escapeHtml(order.customer.email)}</small></div><div><span>Delivery address</span><strong>${escapeHtml(order.customer.address)}</strong><small>${escapeHtml(order.customer.city)}</small></div><div><span>Payment method</span><strong>${escapeHtml(order.paymentMethod)}</strong></div><div><span>Status</span><strong>${escapeHtml(titleCase(order.status))}</strong></div></div>
    ${order.items.map(item => `<div class="history-row"><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.selectedSize)} · ${item.quantity} × ${money(item.price)}</small></span><strong>${money(item.price * item.quantity)}</strong></div>`).join('')}
    <div class="history-row"><span>Subtotal</span><strong>${money(order.subtotal)}</strong></div>${order.discount ? `<div class="history-row"><span>Discount${order.promotionCode ? ` · ${escapeHtml(order.promotionCode)}` : ''}</span><strong>−${money(order.discount)}</strong></div>` : ''}<div class="history-row"><span>Shipping</span><strong>${order.shipping ? money(order.shipping) : 'Free'}</strong></div><div class="history-row"><strong>Total</strong><strong>${money(order.total)}</strong></div>`;
}

function renderAdminInventory() {
  const low = AppStore.availableProducts.filter(product => product.stock > 0 && product.stock < 5).length;
  const out = AppStore.availableProducts.filter(product => product.stock === 0).length;
  $('inventorySummary').innerHTML = `<strong>${low + out}</strong><span>${low + out === 1 ? 'product needs' : 'products need'} attention</span><span class="inventory-summary-detail">${low} low stock · ${out} out of stock</span>`;
  const state = adminListState.inventory;
  const matching = AppStore.availableProducts
    .filter(product => adminInventoryFilter === 'all'
      ? true
      : adminInventoryFilter === 'out' ? product.stock === 0 : product.stock > 0 && product.stock < 5)
    .filter(product => matchesQuery(state.query, product.title, product.categoryName));
  renderAdminList({
    state,
    bodyId: 'adminInventoryBody',
    pagerId: 'adminInventoryPager',
    items: matching,
    label: 'products',
    spokenLabel: 'products in inventory',
    syncPills: () => syncFilterPills('[data-inventory-filter]', 'inventoryFilter', adminInventoryFilter),
    row: product => {
      const status = product.stock === 0 ? 'out' : product.stock < 5 ? 'low' : 'ok';
      const label = status === 'out' ? 'Out of stock' : status === 'low' ? 'Low stock' : 'In stock';
      return `<tr><td data-label="Product"><strong>${escapeHtml(product.title)}</strong></td><td data-label="Category">${escapeHtml(product.categoryName)}</td><td data-label="Stock quantity"><input class="stock-input" type="number" min="0" step="1" value="${product.stock}" data-stock-id="${escapeHtml(product.id)}" aria-label="Stock for ${escapeHtml(product.title)}"></td><td data-label="Status"><span class="admin-status-badge status-${status}">${label}</span></td><td data-label="Update"><button type="button" class="admin-action-btn" data-admin-action="save-stock" data-id="${escapeHtml(product.id)}">Save stock</button></td></tr>`;
    },
    emptyMessage: AppStore.availableProducts.length === 0
      ? 'No products yet.'
      : state.query ? `No products match \u201c${state.query}\u201d.` : adminInventoryFilter === 'out' ? 'Nothing is out of stock.' : 'Everything is above the low-stock threshold.'
  });
}

function renderAdminCustomers() {
  const state = adminListState.customers;
  const all = AppStore.getCustomers();
  // getCustomers() carries name, email and orders, not the delivery city, so
  // cities come from the customer's own orders. The search box promises it.
  const customerCities = customer => [...new Set(customer.orders.map(order => order.customer && order.customer.city).filter(Boolean))].join(' ');
  const customers = all.filter(customer => matchesQuery(state.query, customer.name, customer.email, customerCities(customer)));
  renderAdminList({
    state,
    bodyId: 'adminCustomerBody',
    pagerId: 'adminCustomerPager',
    items: customers,
    label: 'customers',
    row: customer => `<tr>
    <td data-label="Customer"><div><strong>${escapeHtml(customer.name)}</strong><span class="admin-subline">${escapeHtml(customer.email)}</span></div></td><td data-label="Orders">${customer.orders.length}</td><td data-label="Spent">${money(customer.spent)}</td>
    <td data-label="Account status"><select class="admin-status-select" data-admin-action="customer-status" data-email="${escapeHtml(customer.email)}" aria-label="Account status for ${escapeHtml(customer.name)}"><option value="active" ${customer.status === 'active' ? 'selected' : ''}>Active</option><option value="blocked" ${customer.status === 'blocked' ? 'selected' : ''}>Blocked</option></select></td>
    <td data-label="History"><button type="button" class="admin-action-btn" data-admin-action="customer-history" data-email="${escapeHtml(customer.email)}">View history</button></td></tr>`,
    emptyMessage: all.length === 0 ? 'No customers yet.'
      : state.query ? `No customers match \u201c${state.query}\u201d.` : 'No customers to show.',
    afterRender: () => {
      const history = $('customerHistory');
      if (!history.hidden && history.dataset.email) renderCustomerHistory(history.dataset.email);
    }
  });
}

function renderCustomerHistory(email) {
  const customer = AppStore.getCustomers().find(item => item.email === email);
  const history = $('customerHistory');
  if (!customer) { history.hidden = true; return; }
  history.dataset.email = email;
  history.hidden = false;
  const latest = customer.orders[0].customer;
  history.innerHTML = `<div class="editor-heading"><h4>${escapeHtml(customer.name)} · Customer profile</h4><button type="button" class="text-action" data-admin-action="close-history">Close</button></div>
    <div class="customer-profile-grid"><div><span>Email</span><strong>${escapeHtml(customer.email)}</strong></div><div><span>Account status</span><strong>${escapeHtml(titleCase(customer.status))}</strong></div><div><span>Latest delivery address</span><strong>${escapeHtml(latest.address)}</strong><small>${escapeHtml(latest.city)}</small></div><div><span>Order history</span><strong>${customer.orders.length} ${customer.orders.length === 1 ? 'order' : 'orders'}</strong></div></div>
    ${customer.orders.map(order => `<div class="history-row"><span><strong>${escapeHtml(order.reference)}</strong><small>${escapeHtml(formatDate(order.createdAt))} · ${escapeHtml(titleCase(order.status))}</small></span><strong>${money(order.total)}</strong></div>`).join('')}`;
}

function renderAdminAnalytics() {
  const analytics = AppStore.getAnalytics();
  $('analyticsRevenue').textContent = money(analytics.revenue);
  $('analyticsOrders').textContent = analytics.orderCount;
  $('analyticsAvg').textContent = money(analytics.average);
  $('analyticsLowStock').textContent = analytics.lowStock;
  const max = Math.max(1, ...analytics.days.map(day => day.value));
  $('analyticsRevenueChart').innerHTML = analytics.days.map(day => `<div class="chart-column" aria-label="${escapeHtml(day.key)}: ${money(day.value)}"><div class="chart-value">${day.value ? money(day.value) : ''}</div><div class="chart-track"><div class="chart-bar" style="height:${day.value ? Math.max(6, (day.value / max) * 100) : 2}%"></div></div><span>${escapeHtml(day.label)}</span></div>`).join('');
  const top = analytics.topProducts;
  const maxUnits = Math.max(1, ...top.map(item => item.quantity));
  $('analyticsTopProducts').innerHTML = top.length ? top.map(item => `<div class="analytics-bar-row"><div class="analytics-bar-heading"><span>${escapeHtml(item.title)}</span><strong>${item.quantity} sold</strong></div><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.round(item.quantity / maxUnits * 100)}%"></div></div></div>`).join('') : '<div class="analytics-empty">Sales will appear here when orders are placed.</div>';
}

function renderAdminDiscounts() {
  const state = adminListState.promotions;
  const all = AppStore.promotions;
  const status = promo => AppStore.promotionStatus(promo);
  const promotions = all.filter(promo => (adminPromoFilter === 'all' || status(promo) === adminPromoFilter)
    && matchesQuery(state.query, promo.code, promo.type === 'amount' ? `${money(promo.amount)} off` : `${promo.percent}% off`, status(promo)));
  renderAdminList({
    state,
    bodyId: 'adminPromoBody',
    pagerId: 'adminPromoPager',
    items: promotions,
    label: 'promotions',
    syncPills: () => syncFilterPills('[data-promo-filter]', 'promoFilter', adminPromoFilter),
    row: promo => {
      const status = AppStore.promotionStatus(promo);
      const schedule = promo.start || promo.end ? `${promo.start || 'Any time'} – ${promo.end || 'No end date'}` : 'Always';
      const discount = promo.type === 'amount' ? `${money(promo.amount)} off` : `${promo.percent}% off`;
      return `<tr><td data-label="Code"><div><strong>${escapeHtml(promo.code)}</strong>${promo.automatic ? '<span class="admin-subline">Automatic sale</span>' : ''}</div></td><td data-label="Discount">${escapeHtml(discount)}</td><td data-label="Schedule">${escapeHtml(schedule)}</td><td data-label="Status"><span class="admin-status-badge status-${status === 'active' ? 'ok' : status}">${escapeHtml(titleCase(status))}</span></td><td data-label="Actions"><div class="admin-actions"><button type="button" class="admin-action-btn" data-admin-action="toggle-promo" data-code="${escapeHtml(promo.code)}">${promo.active ? 'Disable' : 'Enable'}</button><button type="button" class="admin-action-btn danger" data-admin-action="delete-promo" data-code="${escapeHtml(promo.code)}">Delete</button></div></td></tr>`;
    },
    emptyMessage: all.length === 0 ? 'No promotions yet.'
      : state.query ? `No promotions match \u201c${state.query}\u201d.`
        : adminPromoFilter === 'active' ? 'No promotions are active right now.' : `No ${adminPromoFilter} promotions.`
  });
}

function openProductEditor(product) {
  $('adminProductForm').reset();
  $('productEditorTitle').textContent = product ? 'Edit product' : 'Add product';
  $('productId').value = product ? product.id : '';
  $('productName').value = product ? product.title : '';
  $('productCategory').value = product ? product.category : 'audio';
  $('productPrice').value = product ? product.price : '';
  $('productStock').value = product ? product.stock : '';
  $('productTags').value = product ? (product.tags || []).join(', ') : '';
  $('productDescription').value = product ? product.description : '';
  $('productImage').value = product && !product.image.startsWith('data:image/') ? product.image : '';
  $('productRemoveImage').checked = false;
  $('productRemoveImageLabel').hidden = !product || !product.image;
  $('adminProductEditor').hidden = false;
  $('productName').focus();
}

let confirmAction = null;
let confirmFocus = null;
function requestConfirmation(title, message, buttonText, action) {
  confirmAction = action;
  confirmFocus = document.activeElement;
  $('confirmTitle').textContent = title;
  $('confirmMessage').textContent = message;
  $('confirmAccept').textContent = buttonText;
  $('confirmLayer').hidden = false;
  $('confirmCancel').focus();
}
function closeConfirmation() {
  $('confirmLayer').hidden = true;
  confirmAction = null;
  if (confirmFocus && confirmFocus.isConnected) confirmFocus.focus({ preventScroll: true });
  confirmFocus = null;
}

function refreshStorefront() {
  renderProductGrid();
  renderCartDrawer();
  renderProfile();
  if (isProductRoute()) renderProductPage(productRouteId());
  if (activeLayer === DOM.wishlistModal) renderWishlistModal();
}

// Repaint every price after the display currency changes. Stored prices and
// order totals are untouched; this only re-renders the same numbers into a
// different currency.
function renderCurrencyControl() {
  const code = GreenCartCurrency.get();
  $('currencyToggleSymbol').textContent = GreenCartCurrency.symbols[code];
  $('currencyToggleLabel').textContent = code;
  $('currencyToggleBtn').setAttribute('aria-label', `Switch currency. Prices currently shown in ${code === 'NGN' ? 'Nigerian naira' : 'US dollars'}.`);
}

function refreshCurrencyEverywhere() {
  renderCurrencyControl();
  renderProductGrid();
  renderCartDrawer();
  renderProfile();
  if (isProductRoute()) renderProductPage(productRouteId());
  if (activeLayer === DOM.wishlistModal) renderWishlistModal();
  if (activeLayer === DOM.adminModal) renderAdminPanel();
}

function initSortDropdown() {
  const trigger = $('sortTrigger');
  const menu = $('sortMenu');
  const options = Array.from(menu.querySelectorAll('.sort-option'));
  const close = (focus = false) => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (focus) trigger.focus(); };
  const open = () => {
    menu.hidden = false;
    menu.classList.remove('opens-up');
    const rect = trigger.getBoundingClientRect();
    if (rect.bottom + menu.offsetHeight + 12 > window.innerHeight && rect.top > menu.offsetHeight + 12) menu.classList.add('opens-up');
    trigger.setAttribute('aria-expanded', 'true');
    (options.find(option => option.classList.contains('active')) || options[0]).focus();
  };
  trigger.addEventListener('click', event => { event.stopPropagation(); menu.hidden ? open() : close(); });
  trigger.addEventListener('keydown', event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); if (menu.hidden) open(); } });
  options.forEach((option, index) => {
    option.addEventListener('click', () => {
      AppStore.sortBy = option.dataset.value;
      options.forEach(item => { const active = item === option; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
      $('sortLabel').textContent = option.textContent;
      close(true);
      renderProductGrid();
    });
    option.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
      let next = index;
      if (event.key === 'ArrowDown') next = (index + 1) % options.length;
      else if (event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = options.length - 1;
      else if (event.key === 'Tab') { close(); return; }
      else return;
      event.preventDefault();
      options[next].focus();
    });
  });
  document.addEventListener('click', event => { if (!$('sortCustom').contains(event.target)) close(); });
}

function updatePromotionFields() {
  const isAmount = $('promoType').value === 'amount';
  const input = $('promoPercent');
  $('promoValueLabel').textContent = isAmount ? 'Discount (USD)' : 'Discount (%)';
  input.min = isAmount ? '0.01' : '1';
  input.step = isAmount ? '0.01' : '1';
  if (isAmount) input.removeAttribute('max');
  else input.max = '100';
}


// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
// The checkout has three honest states and no fourth:
//
//   ready      a payment provider is configured; a real charge can be taken
//   disabled   no provider configured; the form refuses to submit an order
//   unverified a charge may have happened but no server confirmed it
//
// There is deliberately no "pretend it worked" state. An order created while
// payments are off would sit in this browser forever, invisible to any seller,
// so the store says so instead of collecting it.

function renderCheckoutAvailability() {
  const status = GreenCartPayments.status();
  const disclosure = $('checkoutDisclosure');
  const submit = $('confirmPayBtn');
  if (status.enabled) {
    // The figure shown here is the shopper's estimate in their chosen currency.
    // The amount actually charged is computed and confirmed by the server.
    disclosure.textContent = `You will be charged ${money(AppStore.getCartTotals().total)} by card. Payment is confirmed before your order is accepted.`;
    disclosure.classList.remove('checkout-disclosure-blocked');
    submit.disabled = false;
    return;
  }
  disclosure.textContent = 'Card payments are not switched on yet, so orders cannot be placed right now.';
  disclosure.classList.add('checkout-disclosure-blocked');
  submit.disabled = false; // still clickable: pressing it explains why, rather than a dead button
}

// Everything placeOrder checks, checked BEFORE any money moves. If a charge
// succeeds and then order creation fails, the customer has paid for nothing and
// the store has no record — so the cheap checks all run first.
function checkoutPreflight(name, address, city, email) {
  if (!AppStore.cart.length) return 'Your bag is empty.';
  if (!name || !address || !city) return 'Complete your delivery details.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (AppStore.state.customerStatuses[email] === 'blocked') return 'This customer account is currently blocked.';
  const stale = AppStore.cart.find(item => {
    const product = AppStore.products.find(p => p.id === item.id);
    return !product || AppStore.quantityInCart(item.id) > product.stock;
  });
  if (stale) return 'The available stock has changed. Review your bag.';
  return '';
}

// A charge that succeeded while order creation failed must not vanish. Keep the
// provider reference so the shopper can quote it and the store can reconcile it.
function recordStrandedPayment(reference, reason) {
  try {
    const key = 'greencart_stranded_payments_v1';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.unshift({ reference: reference, reason: reason, at: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(existing.slice(0, 20)));
  } catch (_) {
    // If even this fails there is nothing further the browser can do; the
    // message below still carries the reference to the screen.
  }
}

async function submitCheckout() {
  const name = $('checkoutName').value.trim();
  const address = $('checkoutAddress').value.trim();
  const city = $('checkoutCity').value.trim();
  const email = $('checkoutEmail').value.trim().toLowerCase();
  const submit = $('confirmPayBtn');

  const blocked = checkoutPreflight(name, address, city, email);
  if (blocked) { showToast(blocked, true); return; }

  const status = GreenCartPayments.status();
  if (!status.enabled) {
    // Do not create the order. Explain, in the checkout, why nothing happened.
    renderCheckoutAvailability();
    showToast('Payments are not switched on yet, so no order was placed.', true);
    $('checkoutDisclosure').focus && $('checkoutDisclosure').focus();
    return;
  }

  // Send WHAT is being bought, not what it costs. The server prices the order,
  // so a tampered browser cannot buy a ₦403,058 item for ₦100.
  const lines = AppStore.cart.map(item => ({ id: item.id, quantity: item.quantity }));
  submit.disabled = true;
  submit.textContent = 'Contacting payment…';
  let outcome;
  try {
    outcome = await GreenCartPayments.charge({
      lines,
      promo: AppStore.state.appliedPromo || '',
      email,
      customer: { name, city }
    });
  } catch (error) {
    outcome = { status: 'failed', reason: error.message || 'The payment could not be started.' };
  } finally {
    submit.disabled = false;
    submit.textContent = 'Place order →';
  }

  if (outcome.status === 'abandoned') {
    showToast('Payment cancelled. Your bag is saved and no charge was made.', true);
    return;
  }

  if (outcome.status === 'failed') {
    const reason = outcome.reason === 'payments-disabled'
      ? 'Payments are not switched on yet, so no order was placed.'
      : outcome.reason || 'The payment could not be completed.';
    showToast(reason, true);
    return;
  }

  // 'paid' or 'unverified'. Both mean money may have moved, so both record the
  // order — losing a paid order is worse than recording an unconfirmed one.
  const order = attempt(() => AppStore.placeOrder({
    name, address, city, email,
    paymentMethod: 'Card',
    payment: {
      provider: 'paystack',
      reference: outcome.reference || '',
      status: outcome.status === 'paid' ? 'paid' : 'unverified'
    }
  }));

  if (!order) {
    recordStrandedPayment(outcome.reference, outcome.reason || 'order creation failed');
    $('orderSuccessTitle').textContent = 'Payment received — contact us';
    $('orderSuccessSummary').textContent = `Your payment reference is ${outcome.reference}. We could not record the order automatically, so please send this reference to the store and we will complete it.`;
    DOM.orderTrackingNum.textContent = outcome.reference || '—';
    DOM.checkoutForm.hidden = true;
    DOM.orderSuccessScreen.hidden = false;
    DOM.checkoutModal.setAttribute('aria-labelledby', 'orderSuccessTitle');
    $('continueShoppingBtn').focus();
    return;
  }

  DOM.orderTrackingNum.textContent = order.reference;
  if (outcome.status === 'paid') {
    $('orderSuccessTitle').textContent = 'Order placed.';
    $('orderSuccessSummary').textContent = 'Your payment was confirmed and your order has been received.';
    showToast('Payment confirmed');
  } else {
    $('orderSuccessTitle').textContent = 'Order received — confirming payment';
    $('orderSuccessSummary').textContent = `We have your order, but the payment is still being confirmed. Keep this reference and contact the store if you are unsure: ${outcome.reference}`;
    showToast('Order saved; payment not yet confirmed', true);
  }
  DOM.checkoutForm.hidden = true;
  DOM.orderSuccessScreen.hidden = false;
  DOM.checkoutModal.setAttribute('aria-labelledby', 'orderSuccessTitle');
  refreshStorefront();
  $('continueShoppingBtn').focus();
}

function initEventListeners() {
  document.addEventListener('click', event => {
    const link = event.target.closest('a[data-product-link], a[data-storefront-link]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    event.preventDefault();
    if (link.dataset.productLink !== undefined) openProductPage(link.dataset.productLink);
    else goToStorefront(link.dataset.storefrontLink, true);
  });
  window.addEventListener('popstate', () => { closeAllModals(); renderRoute(); });
  DOM.navTabs.forEach(tab => tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    if (target === 'home' || target === 'shop') { goToStorefront(target); return; }
    setActiveNav(target);
    if (target === 'cart') { renderCartDrawer(); openLayer(DOM.cartDrawer); }
    if (target === 'wishlist') { renderWishlistModal(); openLayer(DOM.wishlistModal); }
    if (target === 'profile') { renderProfile(); openLayer(DOM.profileModal); }
    if (target === 'admin') { renderAdminPanel(); openLayer(DOM.adminModal); }
  }));
  $('brandLogo').addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (isProductRoute()) { event.preventDefault(); goToStorefront('home'); }
    else { closeAllModals(); setActiveNav('home'); }
  });
  ['cartCloseBtn', 'wishlistCloseBtn', 'checkoutCloseBtn', 'profileCloseBtn', 'adminCloseBtn'].forEach(id => $(id).addEventListener('click', closeAllModals));
  DOM.overlay.addEventListener('click', closeAllModals);
  DOM.categoryPills.forEach(pill => pill.addEventListener('click', () => { AppStore.activeCategory = pill.dataset.category; updateCategories(); renderProductGrid(); }));
  DOM.searchInput.addEventListener('input', event => {
    AppStore.searchQuery = event.target.value;
    DOM.searchClearBtn.classList.toggle('visible', !!event.target.value);
    if (isProductRoute()) goToStorefront('shop');
    renderProductGrid();
  });
  DOM.searchClearBtn.addEventListener('click', () => {
    DOM.searchInput.value = ''; AppStore.searchQuery = ''; DOM.searchClearBtn.classList.remove('visible');
    if (isProductRoute()) goToStorefront('shop');
    renderProductGrid(); DOM.searchInput.focus();
  });
  DOM.productGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) {
      const card = event.target.closest('.product-card');
      if (card && !event.target.closest('a') && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) openProductPage(card.dataset.id);
      return;
    }
    const id = button.dataset.id;
    if (button.dataset.action === 'wishlist') {
      const result = attempt(() => AppStore.toggleWishlist(id));
      if (result !== null) { renderProductGrid(); showToast(result ? 'Saved to your wishlist' : 'Removed from your wishlist'); }
    } else if (button.dataset.action === 'add-cart') {
      const product = attempt(() => AppStore.addToCart(id));
      if (product) { renderProductGrid(); renderCartDrawer(); showToast(`${product.title} added to your bag`); }
    }
  });
  DOM.productPageContent.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !isProductRoute()) return;
    if (button.dataset.color !== undefined || button.dataset.size !== undefined) {
      const isColor = button.dataset.color !== undefined;
      if (isColor) productSelection.color = button.dataset.color;
      else productSelection.size = button.dataset.size;
      button.parentElement.querySelectorAll('button').forEach(option => {
        const selected = option === button;
        option.classList.toggle('active', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
    } else if (button.id === 'productQtyMinus' || button.id === 'productQtyPlus') {
      productSelection.quantity += button.id === 'productQtyPlus' ? 1 : -1;
      updateProductAvailability();
    } else if (button.id === 'productSaveBtn') {
      const saved = attempt(() => AppStore.toggleWishlist(productSelection.id));
      if (saved !== null) { updateProductSaved(); renderProductGrid(); showToast(saved ? 'Saved to your wishlist' : 'Removed from your wishlist'); }
    } else if (button.id === 'productAddToCart') {
      const product = attempt(() => AppStore.addToCart(productSelection.id, productSelection.quantity, { color: productSelection.color, size: productSelection.size }));
      if (product) {
        renderProductGrid(); renderCartDrawer(); openLayer(DOM.cartDrawer); updateProductAvailability();
        showToast(`${product.title} added to your bag`);
      }
    }
  });
  DOM.cartItemsList.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const index = Number(button.dataset.index);
    const result = attempt(() => {
      if (button.dataset.action === 'qty-plus') AppStore.updateCartQty(index, 1);
      if (button.dataset.action === 'qty-minus') AppStore.updateCartQty(index, -1);
      if (button.dataset.action === 'remove-cart') AppStore.removeFromCart(index);
      return true;
    });
    if (result) { renderCartDrawer(); renderProductGrid(); updateProductAvailability(); }
  });
  DOM.wishlistItemsList.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'wishlist-to-cart') {
      const product = attempt(() => AppStore.addToCart(button.dataset.id));
      if (product) { refreshStorefront(); showToast(`${product.title} added to your bag`); }
    }
    if (button.dataset.action === 'remove-wishlist') {
      const result = attempt(() => AppStore.toggleWishlist(button.dataset.id));
      if (result !== null) { renderWishlistModal(); renderProductGrid(); updateProductSaved(); showToast('Removed from your wishlist'); }
    }
  });
  $('promoApplyBtn').addEventListener('click', () => {
    if (!DOM.promoInput.value.trim()) { showToast('Enter a promotion code.', true); return; }
    const promo = attempt(() => AppStore.applyPromo(DOM.promoInput.value));
    if (promo) { renderCartDrawer(); showToast(`${promo.code} applied`); }
  });
  $('promoRemoveBtn').addEventListener('click', () => {
    const removed = attempt(() => { AppStore.removePromo(); return true; });
    if (removed) { renderCartDrawer(); showToast('Promotion removed'); }
  });
  DOM.checkoutTriggerBtn.addEventListener('click', () => {
    if (!AppStore.cart.length) return;
    DOM.checkoutForm.reset();
    DOM.checkoutForm.hidden = false;
    DOM.orderSuccessScreen.hidden = true;
    DOM.checkoutModal.setAttribute('aria-labelledby', 'checkoutTitle');
    selectPayment(document.querySelector('.pay-card-pill'));
    renderCheckoutAvailability();
    openLayer(DOM.checkoutModal);
  });
  const paymentButtons = Array.from(document.querySelectorAll('.pay-card-pill'));
  paymentButtons.forEach((button, index) => {
    button.addEventListener('click', () => selectPayment(button));
    button.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
      event.preventDefault();
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
      const next = paymentButtons[(index + direction + paymentButtons.length) % paymentButtons.length];
      selectPayment(next); next.focus();
    });
  });
  DOM.checkoutForm.addEventListener('submit', event => {
    event.preventDefault();
    submitCheckout();
  });
  $('continueShoppingBtn').addEventListener('click', () => goToStorefront('home'));
  $('currencyToggleBtn').addEventListener('click', () => {
    const code = GreenCartCurrency.toggle();
    refreshCurrencyEverywhere();
    renderCheckoutAvailability();
    showToast(`Prices now in ${code === 'NGN' ? 'naira' : 'US dollars'}`);
  });
  DOM.themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.toggle('dark-mode');
    updateThemeControl(isDark);
    try { localStorage.setItem('greencart_theme', isDark ? 'dark' : 'light'); } catch (_) { }
    showThemeNotice(isDark);
  });
  document.querySelectorAll('.admin-tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach(item => { item.classList.toggle('active', item === tab); if (item === tab) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current'); });
    document.querySelectorAll('.admin-panel').forEach(panel => { const active = panel.id === `admin-${tab.dataset.admin}`; panel.classList.toggle('active', active); panel.hidden = !active; });
    // Switching tabs only toggles visibility, so the live region would keep
    // describing the list just left. Re-render the opened list so its own range
    // is announced, and a freshly opened empty list clears the message instead.
    const opened = { products: renderAdminProducts, orders: renderAdminOrders, inventory: renderAdminInventory,
      customers: renderAdminCustomers, discounts: renderAdminDiscounts }[tab.dataset.admin];
    if (opened) opened();
  }));
  document.querySelectorAll('[data-product-filter]').forEach(pill => pill.addEventListener('click', () => {
    adminProductFilter = pill.dataset.productFilter;
    adminListState.products.page = 1;
    renderAdminProducts();
  }));
  document.querySelectorAll('[data-order-filter]').forEach(pill => pill.addEventListener('click', () => {
    adminOrderFilter = pill.dataset.orderFilter;
    adminListState.orders.page = 1;
    renderAdminOrders();
  }));
  document.querySelectorAll('[data-inventory-filter]').forEach(pill => pill.addEventListener('click', () => {
    adminInventoryFilter = pill.dataset.inventoryFilter;
    adminListState.inventory.page = 1;
    renderAdminInventory();
  }));
  document.querySelectorAll('[data-promo-filter]').forEach(pill => pill.addEventListener('click', () => {
    adminPromoFilter = pill.dataset.promoFilter;
    adminListState.promotions.page = 1;
    renderAdminDiscounts();
  }));
  // Search resets to page one, so results are never hidden on a later page.
  [['adminProductSearch', 'products', renderAdminProducts],
   ['adminOrderSearch', 'orders', renderAdminOrders],
   ['adminInventorySearch', 'inventory', renderAdminInventory],
   ['adminCustomerSearch', 'customers', renderAdminCustomers],
   ['adminPromoSearch', 'promotions', renderAdminDiscounts]].forEach(([id, key, rerender]) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('input', () => {
      adminListState[key].query = input.value;
      adminListState[key].page = 1;
      rerender();
    });
  });
  document.querySelector('.admin-content').addEventListener('click', event => {
    const button = event.target.closest('[data-page-target]');
    if (!button) return;
    const state = adminListState[button.dataset.pageTarget];
    if (!state) return;
    const rerender = { products: renderAdminProducts, orders: renderAdminOrders, inventory: renderAdminInventory,
      customers: renderAdminCustomers, promotions: renderAdminDiscounts }[state.key];
    state.page = Math.max(1, (state.page || 1) + Number(button.dataset.pageDelta));
    // renderPager restores focus itself when the pager owned it, so clicks and
    // re-renders from other actions are handled by the same path.
    rerender();
  });
  $('adminRecoveryDismiss').addEventListener('click', () => {
    if (AppStore.recovery) AppStore.recovery.dismissed = true;
    renderAdminRecovery();
    showToast('Saved data was left untouched; it will be replaced when you save a change.');
  });
  $('addProductBtn').addEventListener('click', () => openProductEditor(null));
  $('cancelProductEdit').addEventListener('click', () => { $('adminProductEditor').hidden = true; });
  $('adminProductForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.target.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const file = $('productImageFile').files[0];
      const existing = AppStore.products.find(product => product.id === $('productId').value);
      let image = $('productImage').value.trim();
      if (!image && existing && existing.image.startsWith('data:image/') && !$('productRemoveImage').checked) image = existing.image;
      if ($('productRemoveImage').checked && !file) image = '';
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image under 1 MB.');
        image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('The image could not be read.')); reader.readAsDataURL(file); });
      }
      if (!validImageSource(image)) throw new Error('Enter a valid image URL or path.');
      AppStore.saveProduct({ id: $('productId').value, title: $('productName').value, category: $('productCategory').value, price: $('productPrice').value, stock: $('productStock').value, tags: $('productTags').value.split(','), description: $('productDescription').value, image });
      $('adminProductEditor').hidden = true;
      refreshStorefront(); renderAdminPanel(); showToast('Product saved');
    } catch (error) { showToast(error.message || 'Product could not be saved.', true); }
    finally { submit.disabled = false; }
  });
  $('addPromoBtn').addEventListener('click', () => { $('adminPromoForm').reset(); updatePromotionFields(); $('adminPromoEditor').hidden = false; $('promoCode').focus(); });
  $('promoType').addEventListener('change', updatePromotionFields);
  $('cancelPromoEdit').addEventListener('click', () => { $('adminPromoEditor').hidden = true; });
  $('adminPromoForm').addEventListener('submit', event => {
    event.preventDefault();
    const saved = attempt(() => { AppStore.addPromotion({ code: $('promoCode').value, type: $('promoType').value, value: $('promoPercent').value, automatic: $('promoAutomatic').checked, start: $('promoStart').value, end: $('promoEnd').value }); return true; });
    if (saved) { $('adminPromoEditor').hidden = true; renderAdminDiscounts(); renderCartDrawer(); showToast('Promotion saved'); }
  });
  DOM.adminModal.addEventListener('click', event => {
    const button = event.target.closest('[data-admin-action]');
    if (!button || button.tagName === 'SELECT') return;
    const action = button.dataset.adminAction;
    const id = button.dataset.id;
    if (action === 'edit-product') openProductEditor(AppStore.products.find(product => product.id === id));
    if (action === 'archive-product') {
      const product = AppStore.products.find(item => item.id === id);
      if (product) requestConfirmation(
        'Archive product?',
        `Archive ${product.title}? It leaves the storefront, search and inventory and is removed from bags and saved items on this device. Past orders keep their details, and you can restore it later.`,
        'Archive product',
        () => { AppStore.archiveProduct(id); refreshStorefront(); renderAdminPanel(); showToast('Product archived'); }
      );
    }
    if (action === 'restore-product') {
      const saved = attempt(() => { AppStore.restoreProduct(id); return true; });
      if (saved) { refreshStorefront(); renderAdminProducts(); showToast('Product restored'); }
    }
    if (action === 'delete-product') {
      const product = AppStore.products.find(item => item.id === id);
      if (product) requestConfirmation(
        'Delete permanently?',
        `Permanently delete ${product.title}? This cannot be undone. Only archived products with no past orders can be deleted.`,
        'Delete permanently',
        () => { AppStore.deleteProduct(id); refreshStorefront(); renderAdminPanel(); showToast('Product deleted'); }
      );
    }
    if (action === 'save-stock') {
      const input = Array.from(document.querySelectorAll('[data-stock-id]')).find(item => item.dataset.stockId === id);
      const saved = attempt(() => { AppStore.updateStock(id, input.value); return true; });
      if (saved) { refreshStorefront(); renderAdminPanel(); showToast('Stock updated'); }
    }
    if (action === 'refund') {
      const reference = button.dataset.reference;
      requestConfirmation('Record refund?', `Record a full refund for ${reference}? No payment will be returned.`, 'Record refund', () => { AppStore.refundOrder(reference); renderAdminPanel(); renderProfile(); showToast('Refund recorded'); });
    }
    if (action === 'order-details') renderOrderDetails(button.dataset.reference);
    if (action === 'close-order-details') $('orderDetails').hidden = true;
    if (action === 'customer-history') renderCustomerHistory(button.dataset.email);
    if (action === 'close-history') $('customerHistory').hidden = true;
    if (action === 'toggle-promo') { const saved = attempt(() => { AppStore.togglePromotion(button.dataset.code); return true; }); if (saved) { renderAdminDiscounts(); renderCartDrawer(); showToast('Promotion updated'); } }
    if (action === 'delete-promo') {
      const code = button.dataset.code;
      requestConfirmation('Delete promotion?', `Delete ${code}? It will no longer be available in the bag.`, 'Delete promotion', () => { AppStore.deletePromotion(code); renderAdminDiscounts(); renderCartDrawer(); showToast('Promotion deleted'); });
    }
  });
  DOM.adminModal.addEventListener('change', event => {
    const select = event.target;
    if (select.dataset.adminAction === 'order-status') {
      const saved = attempt(() => { AppStore.updateOrderStatus(select.dataset.reference, select.value); return true; });
      if (saved) { renderAdminPanel(); renderProfile(); showToast('Order status updated'); } else renderAdminOrders();
    }
    if (select.dataset.adminAction === 'customer-status') {
      const saved = attempt(() => { AppStore.setCustomerStatus(select.dataset.email, select.value); return true; });
      if (saved) { renderAdminCustomers(); showToast('Customer status updated'); } else renderAdminCustomers();
    }
  });
  $('confirmCancel').addEventListener('click', closeConfirmation);
  $('confirmLayer').querySelector('.confirm-backdrop').addEventListener('click', closeConfirmation);
  $('confirmAccept').addEventListener('click', () => { const action = confirmAction; closeConfirmation(); if (action) attempt(action); });
  document.addEventListener('error', event => {
    const img = event.target;
    if (img.tagName === 'IMG' && img.dataset.fallbackCategory && !img.dataset.fallbackUsed) { img.dataset.fallbackUsed = 'true'; img.src = getCategorySvg(img.dataset.fallbackCategory); }
  }, true);
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (!$('confirmLayer').hidden) { closeConfirmation(); return; }
      closeAllModals();
      return;
    }
    if (event.key !== 'Tab' || !activeLayer) return;
    const root = !$('confirmLayer').hidden ? $('confirmLayer') : activeLayer;
    const focusable = Array.from(root.querySelectorAll('button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length && !element.closest('[hidden]'));
    if (!focusable.length) { event.preventDefault(); root.focus(); return; }
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement) || document.activeElement === root)) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== STORE_STATE_KEY) return;
    const refreshed = new Store(window.STORE_DATA.products, window.localStorage);
    AppStore.state = refreshed.state;
    refreshStorefront();
    if (activeLayer === DOM.adminModal) renderAdminPanel();
  });
}

function updateThemeControl(isDark) {
  DOM.themeToggleBtn.setAttribute('aria-pressed', String(isDark));
  DOM.themeToggleLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
}

let savedTheme = 'light';
try { savedTheme = localStorage.getItem('greencart_theme') || localStorage.getItem('aura_theme') || 'light'; } catch (_) { }
document.body.classList.toggle('dark-mode', savedTheme === 'dark');
updateThemeControl(savedTheme === 'dark');
// The owner reaches the admin with ?admin=1 now that it is out of the public
// nav. This is convenience, NOT access control: anyone who knows the URL can
// still open it. Real authorization needs the server described in
// docs/PAYMENTS.md, which is why the admin panel is still described as local.
function applyAdminVisibility() {
  const wantsAdmin = new URLSearchParams(window.location.search).get('admin') === '1';
  if (wantsAdmin) {
    const adminTab = document.querySelector('.site-nav-link[data-tab="admin"]');
    if (adminTab) adminTab.hidden = false;
  }
}

renderCurrencyControl();
applyAdminVisibility();
renderProductGrid();
renderCartDrawer();
initSortDropdown();
initEventListeners();
renderRoute();
