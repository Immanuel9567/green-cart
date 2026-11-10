const STORE_STATE_KEY = 'greencart_store_v1';
// Keys written by the previous brand name. Read once on boot and copied to the
// new key, so renaming the brand does not silently empty a returning visitor's
// cart, saved items and order history.
const LEGACY_STORE_STATE_KEYS = ['v8_store_v1'];
const STORE_CATEGORIES = {
  audio: 'Audio',
  timepieces: 'Timepieces',
  footwear: 'Footwear',
  living: 'Living & Decor',
  tech: 'Workspace & Tech'
};
const DEFAULT_PROMOTIONS = [
  { code: 'GC15', percent: 15, active: true, start: '', end: '' },
  { code: 'MONO15', percent: 15, active: true, start: '', end: '' },
  { code: 'VIP25', percent: 25, active: true, start: '', end: '' }
];
// Fulfilment is a one-way path: an order may only move to a listed next status.
// Cancelling is allowed until delivery; refunds are recorded separately by refundOrder.
const ORDER_STATUS_FLOW = {
  pending: ['processing', 'cancelled'],
  processing: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
  refunded: []
};
const nextOrderStatusesFor = status => [...(ORDER_STATUS_FLOW[status] || [])];
const refundableStatuses = ['shipped', 'delivered'];

// Admin list helpers. The demo has no server, so paging happens here; the shape
// (page, pageCount, total) is what a real server-side implementation returns.
const ADMIN_PAGE_SIZE = 10;

function paginate(items, page = 1, pageSize = ADMIN_PAGE_SIZE) {
  const list = Array.isArray(items) ? items : [];
  const size = Math.max(1, Math.floor(Number(pageSize)) || ADMIN_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const requested = Math.floor(Number(page)) || 1;
  const current = Math.min(pageCount, Math.max(1, requested));
  const start = (current - 1) * size;
  return { page: current, pageCount, pageSize: size, total: list.length, start, items: list.slice(start, start + size) };
}

function matchesQuery(query, ...values) {
  const needle = String(query == null ? '' : query).trim().toLowerCase();
  if (!needle) return true;
  return values.some(value => String(value == null ? '' : value).toLowerCase().includes(needle));
}

class Store {
  constructor(seedProducts, storage, now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.activeCategory = 'all';
    this.searchQuery = '';
    this.sortBy = 'featured';
    // Adopt a legacy save if the new key has never been written.
    if (this.readRaw(STORE_STATE_KEY) === null) {
      const legacyKey = LEGACY_STORE_STATE_KEYS.find(key => this.readRaw(key) !== null);
      if (legacyKey) {
        const legacyValue = this.readRaw(legacyKey);
        try {
          this.storage.setItem(STORE_STATE_KEY, legacyValue);
        } catch (_) { /* storage full: the in-memory read below still works */ }
        this.migratedFrom = legacyKey;
      }
    }
    const saved = this.read(STORE_STATE_KEY, null);
    // A stored value that exists but does not parse, or parses to something that
    // is not an object, used to be discarded in silence: the shop reverted to
    // seed data and past orders were gone with no explanation. Record it so the
    // UI can say so rather than pretend nothing happened.
    const raw = this.readRaw(STORE_STATE_KEY);
    this.recovery = null;
    if (raw !== null) {
      const unreadable = saved === null || typeof saved !== 'object';
      if (unreadable) {
        this.recovery = { reason: saved === null ? 'unreadable' : 'unexpected shape', bytes: raw.length };
      }
    }
    const source = saved && typeof saved === 'object' ? saved : {};
    const products = (Array.isArray(source.products) ? source.products : seedProducts).map(product => this.normalizeProduct(product));
    const cart = Array.isArray(source.cart) ? source.cart : this.read('aura_cart', []);
    const wishlist = Array.isArray(source.wishlist) ? source.wishlist : this.read('aura_wishlist', []);
    this.state = {
      products,
      cart: this.reconcileCart(Array.isArray(cart) ? cart : [], products),
      wishlist: (Array.isArray(wishlist) ? wishlist : []).filter(id => products.some(product => product.id === id)),
      orders: Array.isArray(source.orders) ? source.orders : [],
      promotions: Array.isArray(source.promotions) ? source.promotions : DEFAULT_PROMOTIONS.map(promo => ({ ...promo })),
      customerStatuses: source.customerStatuses && typeof source.customerStatuses === 'object' ? source.customerStatuses : {},
      appliedPromo: typeof source.appliedPromo === 'string' ? source.appliedPromo : ''
    };
  }

  read(key, fallback) {
    try {
      const value = this.storage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  // The raw stored string, or null when nothing is stored. read() cannot tell a
  // key that was never written from one that failed to parse; this can.
  readRaw(key) {
    try {
      return this.storage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  commit(patch) {
    const next = { ...this.state, ...patch };
    try {
      this.storage.setItem(STORE_STATE_KEY, JSON.stringify(next));
    } catch (_) {
      throw new Error('Changes could not be saved on this device. Check available storage.');
    }
    this.state = next;
  }

  normalizeProduct(product) {
    const category = STORE_CATEGORIES[product.category] ? product.category : 'audio';
    const stock = Number.isFinite(Number(product.stock)) ? Math.max(0, Math.floor(Number(product.stock))) : (product.inStock === false ? 0 : 10);
    const archivedAt = product.archivedAt ? String(product.archivedAt) : '';
    const title = String(product.title || product.name || 'Untitled product');
    const tags = Array.isArray(product.tags) ? product.tags.map(String).filter(Boolean) : (product.badge ? [String(product.badge)] : []);
    return {
      ...product,
      id: String(product.id),
      title,
      name: title,
      category,
      categoryName: STORE_CATEGORIES[category],
      price: Math.max(0, Number(product.price) || 0),
      stock,
      inStock: stock > 0,
      description: String(product.description || ''),
      image: String(product.image || ''),
      tags,
      badge: tags[0] || '',
      colors: Array.isArray(product.colors) && product.colors.length ? product.colors : ['#111215'],
      sizes: Array.isArray(product.sizes) && product.sizes.length ? product.sizes : ['Standard'],
      rating: Number(product.rating) || 0,
      reviewsCount: Number(product.reviewsCount) || 0,
      archivedAt,
      archived: Boolean(archivedAt)
    };
  }

  reconcileCart(cart, products = this.state.products) {
    const available = products.filter(product => !product.archived);
    const used = new Map();
    return cart.reduce((result, item) => {
      const product = available.find(p => p.id === item.id);
      if (!product) return result;
      const quantity = Math.min(Math.max(0, Math.floor(Number(item.quantity) || 0)), Math.max(0, product.stock - (used.get(product.id) || 0)));
      if (!quantity) return result;
      used.set(product.id, (used.get(product.id) || 0) + quantity);
      result.push({
        id: product.id,
        quantity,
        selectedColor: product.colors.includes(item.selectedColor) ? item.selectedColor : product.colors[0],
        selectedSize: product.sizes.includes(item.selectedSize) ? item.selectedSize : product.sizes[0]
      });
      return result;
    }, []);
  }

  // Admin lists every product, including archived ones. The storefront, bag,
  // saved items and stock alerts only consider available products.
  get products() { return this.state.products; }
  get availableProducts() { return this.state.products.filter(product => !product.archived); }
  get cart() { return this.state.cart; }
  get orders() { return this.state.orders; }
  get promotions() { return this.state.promotions; }
  get wishlist() { return new Set(this.state.wishlist); }

  getCartCount() {
    return this.cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  quantityInCart(productId) {
    return this.cart.filter(item => item.id === productId).reduce((sum, item) => sum + item.quantity, 0);
  }

  addToCart(productId, quantity = 1, options = {}) {
    const product = this.availableProducts.find(p => p.id === productId);
    if (!product) throw new Error('This product is no longer available.');
    quantity = Math.floor(Number(quantity));
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error('Choose a valid quantity.');
    const available = product.stock - this.quantityInCart(productId);
    if (quantity > available) throw new Error(available > 0 ? `Only ${available} more available.` : 'No more of this item are available.');
    const selectedColor = product.colors.includes(options.color) ? options.color : product.colors[0];
    const selectedSize = product.sizes.includes(options.size) ? options.size : product.sizes[0];
    const cart = this.cart.map(item => ({ ...item }));
    const existing = cart.find(item => item.id === productId && item.selectedColor === selectedColor && item.selectedSize === selectedSize);
    if (existing) existing.quantity += quantity;
    else cart.push({ id: productId, quantity, selectedColor, selectedSize });
    this.commit({ cart });
    return product;
  }

  updateCartQty(index, delta) {
    const item = this.cart[index];
    if (!item) return;
    const product = this.products.find(p => p.id === item.id);
    if (delta > 0 && (!product || this.quantityInCart(item.id) + delta > product.stock)) throw new Error('No more of this item are available.');
    const cart = this.cart.map(entry => ({ ...entry }));
    cart[index].quantity += delta;
    if (cart[index].quantity <= 0) cart.splice(index, 1);
    this.commit({ cart });
  }

  removeFromCart(index) {
    this.commit({ cart: this.cart.filter((_, i) => i !== index) });
  }

  toggleWishlist(productId) {
    if (!this.availableProducts.some(product => product.id === productId)) throw new Error('This product is no longer available.');
    const exists = this.state.wishlist.includes(productId);
    const wishlist = exists ? this.state.wishlist.filter(id => id !== productId) : [...this.state.wishlist, productId];
    this.commit({ wishlist });
    return !exists;
  }

  isWishlisted(productId) { return this.state.wishlist.includes(productId); }

  promotionStatus(promotion) {
    if (!promotion.active) return 'disabled';
    const today = this.localDate(this.now());
    if (promotion.start && today < promotion.start) return 'scheduled';
    if (promotion.end && today > promotion.end) return 'expired';
    return 'active';
  }

  localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  applyPromo(code) {
    const normalized = String(code).trim().toUpperCase();
    const promotion = this.promotions.find(promo => promo.code === normalized);
    if (!promotion || this.promotionStatus(promotion) !== 'active') throw new Error('This promotion code is not active.');
    this.commit({ appliedPromo: normalized });
    return promotion;
  }

  removePromo() {
    this.commit({ appliedPromo: '' });
  }

  getCartTotals() {
    const subtotal = Math.round(this.cart.reduce((sum, item) => {
      const product = this.products.find(p => p.id === item.id);
      return sum + (product ? product.price * item.quantity : 0);
    }, 0) * 100) / 100;
    let promotion = this.promotions.find(promo => promo.code === this.state.appliedPromo && this.promotionStatus(promo) === 'active');
    if (!promotion && subtotal > 0) {
      promotion = this.promotions.filter(promo => promo.automatic && this.promotionStatus(promo) === 'active')
        .sort((a, b) => this.promotionDiscount(b, subtotal) - this.promotionDiscount(a, subtotal))[0];
    }
    const discount = promotion ? this.promotionDiscount(promotion, subtotal) : 0;
    const shipping = subtotal > 150 || subtotal === 0 ? 0 : 15;
    return { subtotal, discount, shipping, total: Math.max(0, Math.round((subtotal - discount + shipping) * 100) / 100), promotion: promotion || null };
  }

  promotionDiscount(promotion, subtotal) {
    if (promotion.type === 'amount') return Math.min(subtotal, Math.max(0, Number(promotion.amount) || 0));
    const percent = Math.min(100, Math.max(0, Number(promotion.percent) || 0));
    // Work in whole cents so rounding happens at the cent level, half up.
    // Rounding the dollar figure first (subtotal * percent) mis-rounds exact
    // half-cent ties such as 15% of 4.10 (= 0.615).
    const subtotalCents = Math.round(subtotal * 100);
    const discountCents = Math.floor((subtotalCents * percent + 50) / 100);
    return Math.min(subtotal, discountCents / 100);
  }

  saveProduct(input) {
    const title = String(input.title || '').trim();
    const description = String(input.description || '').trim();
    const category = input.category;
    const price = Number(input.price);
    const stock = Number(input.stock);
    if (!title || !description || !STORE_CATEGORIES[category]) throw new Error('Complete the product name, category, and description.');
    if (input.price === '' || !Number.isFinite(price) || price < 0 || Math.abs(price * 100 - Math.round(price * 100)) > 0.000001) throw new Error('Enter a valid product price with up to two decimal places.');
    if (input.stock === '' || !Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a whole number of zero or more.');
    const existing = input.id ? this.products.find(p => p.id === input.id) : null;
    if (input.id && !existing) throw new Error('This product is no longer available.');
    const tags = (Array.isArray(input.tags) ? input.tags : []).map(tag => String(tag).trim()).filter(Boolean).slice(0, 8);
    const id = existing ? existing.id : this.uniqueId('product');
    const product = this.normalizeProduct({
      ...(existing || {}),
      id, title, name: title, category, price, stock, description, tags,
      image: String(input.image || '').trim(),
      originalPrice: existing && Number(existing.originalPrice) > price ? Number(existing.originalPrice) : null
    });
    const products = existing ? this.products.map(p => p.id === id ? product : p) : [...this.products, product];
    this.commit({ products, cart: this.reconcileCart(this.cart, products) });
    return product;
  }

  updateStock(id, value) {
    const stock = Number(value);
    if (value === '' || !Number.isInteger(stock) || stock < 0) throw new Error('Stock must be a whole number of zero or more.');
    if (!this.products.some(product => product.id === id)) throw new Error('This product is no longer available.');
    const products = this.products.map(product => product.id === id ? { ...product, stock, inStock: stock > 0 } : product);
    this.commit({ products, cart: this.reconcileCart(this.cart, products) });
  }

  productHasSales(id) {
    return this.orders.some(order => (order.items || []).some(item => item.id === id));
  }

  archiveProduct(id) {
    const product = this.products.find(item => item.id === id);
    if (!product) throw new Error('This product is no longer available.');
    if (product.archived) return product;
    const products = this.products.map(item => item.id === id ? { ...item, archivedAt: this.now().toISOString(), archived: true } : item);
    this.commit({ products, cart: this.reconcileCart(this.cart, products), wishlist: this.state.wishlist.filter(itemId => itemId !== id) });
    return products.find(item => item.id === id);
  }

  restoreProduct(id) {
    const product = this.products.find(item => item.id === id);
    if (!product) throw new Error('This product is no longer available.');
    const products = this.products.map(item => item.id === id ? { ...item, archivedAt: '', archived: false } : item);
    this.commit({ products });
    return products.find(item => item.id === id);
  }

  // Permanent deletion is a two-step mistake-fix, not a way to retire a product:
  // the product must be archived first, and anything that has been sold can never
  // be deleted, so its order history stays inspectable.
  deleteProduct(id) {
    const product = this.products.find(item => item.id === id);
    if (this.productHasSales(id)) {
      throw new Error('This product appears in past orders, so it can only be archived. Archive it instead to keep its order history.');
    }
    if (product && !product.archived) {
      throw new Error('Archive this product before deleting it permanently.');
    }
    const products = this.products.filter(product => product.id !== id);
    this.commit({ products, cart: this.reconcileCart(this.cart, products), wishlist: this.state.wishlist.filter(itemId => itemId !== id) });
  }

  addPromotion(input) {
    const code = String(input.code || '').trim().toUpperCase();
    const type = input.type || 'percent';
    const value = Number(input.value === undefined ? input.percent : input.value);
    const start = input.start || '';
    const end = input.end || '';
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new Error('Use 3–24 letters, numbers, underscores, or hyphens for the code.');
    if (this.promotions.some(promo => promo.code === code)) throw new Error('A promotion with that code already exists.');
    if (!['percent', 'amount'].includes(type) || !Number.isFinite(value) || value <= 0) throw new Error('Enter a valid discount.');
    if (type === 'percent' && (!Number.isInteger(value) || value > 100)) throw new Error('Percentage must be a whole number from 1 to 100.');
    if (type === 'amount' && (value > 1000000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001)) throw new Error('Enter a valid fixed amount with up to two decimal places.');
    if ((start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) || (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) || (start && end && start > end)) throw new Error('Choose a valid promotion date range.');
    const discount = type === 'amount' ? { amount: value } : { percent: value };
    this.commit({ promotions: [...this.promotions, { code, type, ...discount, automatic: !!input.automatic, start, end, active: true }] });
  }

  togglePromotion(code) {
    this.commit({ promotions: this.promotions.map(promo => promo.code === code ? { ...promo, active: !promo.active } : promo) });
  }

  deletePromotion(code) {
    this.commit({ promotions: this.promotions.filter(promo => promo.code !== code), appliedPromo: this.state.appliedPromo === code ? '' : this.state.appliedPromo });
  }

  uniqueId(prefix) {
    const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  placeOrder(details) {
    if (!this.cart.length) throw new Error('Your bag is empty.');
    const customer = {
      name: String(details.name || '').trim(),
      address: String(details.address || '').trim(),
      city: String(details.city || '').trim(),
      email: String(details.email || '').trim().toLowerCase()
    };
    if (!customer.name || !customer.address || !customer.city || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error('Complete your delivery details with a valid email address.');
    if (this.state.customerStatuses[customer.email] === 'blocked') throw new Error('This customer account is currently blocked.');
    const totals = this.getCartTotals();
    const items = this.cart.map(item => {
      const product = this.products.find(p => p.id === item.id);
      if (!product || this.quantityInCart(item.id) > product.stock) throw new Error('The available stock has changed. Review your bag.');
      return { id: product.id, title: product.title, category: product.category, image: product.image, price: product.price, quantity: item.quantity, selectedColor: item.selectedColor, selectedSize: item.selectedSize };
    });
    const now = this.now();
    let reference;
    do {
      reference = `GC-${now.getFullYear()}-${this.uniqueId('order').slice(6).toUpperCase()}`;
    } while (this.orders.some(order => order.reference === reference));
    const order = {
      reference,
      createdAt: now.toISOString(),
      status: 'pending',
      customer,
      items,
      subtotal: totals.subtotal,
      discount: totals.discount,
      shipping: totals.shipping,
      total: totals.total,
      promotionCode: totals.promotion ? totals.promotion.code : '',
      paymentMethod: String(details.paymentMethod || 'Card'),
      // Payment state is recorded, never inferred. 'none' means no provider was
      // involved; 'paid' only ever comes from a server that verified the charge.
      payment: details.payment && typeof details.payment === 'object'
        ? {
            provider: String(details.payment.provider || ''),
            reference: String(details.payment.reference || ''),
            status: ['paid', 'unverified', 'none'].includes(details.payment.status) ? details.payment.status : 'unverified'
          }
        : { provider: '', reference: '', status: 'none' }
    };
    const products = this.products.map(product => {
      const sold = items.filter(item => item.id === product.id).reduce((sum, item) => sum + item.quantity, 0);
      return sold ? { ...product, stock: product.stock - sold, inStock: product.stock - sold > 0 } : product;
    });
    this.commit({ products, orders: [order, ...this.orders], cart: [], appliedPromo: '' });
    return order;
  }

  nextOrderStatuses(reference) {
    const order = this.orders.find(item => item.reference === reference);
    if (!order) throw new Error('This order could not be found.');
    return nextOrderStatusesFor(order.status);
  }

  updateOrderStatus(reference, status) {
    if (!Object.prototype.hasOwnProperty.call(ORDER_STATUS_FLOW, status)) throw new Error('Choose a valid order status.');
    const order = this.orders.find(item => item.reference === reference);
    if (!order) throw new Error('This order could not be found.');
    if (order.status === 'refunded') throw new Error('This order cannot be updated.');
    const allowed = ORDER_STATUS_FLOW[order.status] || [];
    if (!allowed.length) throw new Error(`This order is ${order.status} and cannot be updated.`);
    if (!allowed.includes(status)) {
      throw new Error(`This order can only move from ${order.status} to ${allowed.join(' or ')}.`);
    }
    const products = status === 'cancelled' ? this.restockOrderItems(order) : this.products;
    this.commit({ products, orders: this.orders.map(item => item.reference === reference ? { ...item, status } : item) });
  }

  restockOrderItems(order) {
    const sold = new Map();
    (order.items || []).forEach(item => sold.set(item.id, (sold.get(item.id) || 0) + (Number(item.quantity) || 0)));
    return this.products.map(product => {
      const quantity = sold.get(product.id) || 0;
      if (!quantity) return product;
      const stock = product.stock + quantity;
      return { ...product, stock, inStock: stock > 0 };
    });
  }

  refundOrder(reference) {
    const order = this.orders.find(item => item.reference === reference);
    if (!order || order.status === 'refunded') throw new Error('This order cannot be refunded.');
    // Only record a refund for something that was actually dispatched.
    if (!refundableStatuses.includes(order.status)) {
      throw new Error(order.status === 'cancelled'
        ? 'This order was cancelled, so it cannot be refunded.'
        : 'This order can only be refunded after it is shipped or delivered.');
    }
    this.commit({ orders: this.orders.map(item => item.reference === reference ? { ...item, status: 'refunded', refundedAt: this.now().toISOString(), refundAmount: item.total } : item) });
  }

  getCustomers() {
    const customers = new Map();
    this.orders.forEach(order => {
      if (!order.customer || !order.customer.email) return;
      const email = order.customer.email.toLowerCase();
      if (!customers.has(email)) customers.set(email, { name: order.customer.name, email, status: this.state.customerStatuses[email] || 'active', orders: [], spent: 0 });
      const customer = customers.get(email);
      customer.orders.push(order);
      if (!['refunded', 'cancelled'].includes(order.status)) customer.spent += Number(order.total) || 0;
    });
    return Array.from(customers.values());
  }

  setCustomerStatus(email, status) {
    if (!['active', 'blocked'].includes(status) || !this.getCustomers().some(customer => customer.email === email)) throw new Error('This customer could not be updated.');
    this.commit({ customerStatuses: { ...this.state.customerStatuses, [email]: status } });
  }

  getAnalytics() {
    const orders = this.orders.filter(order => !['refunded', 'cancelled'].includes(order.status));
    const revenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const days = [];
    const today = this.now();
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
      const key = this.localDate(date);
      const value = orders.filter(order => this.localDate(new Date(order.createdAt)) === key).reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      days.push({ key, label: date.toLocaleDateString(undefined, { weekday: 'short' }), value });
    }
    const sales = new Map();
    orders.forEach(order => (order.items || []).forEach(item => {
      const existing = sales.get(item.id) || { id: item.id, title: item.title, quantity: 0 };
      existing.quantity += Number(item.quantity) || 0;
      sales.set(item.id, existing);
    }));
    return { revenue, orderCount: orders.length, average: orders.length ? revenue / orders.length : 0, lowStock: this.availableProducts.filter(product => product.stock < 5).length, days, topProducts: Array.from(sales.values()).sort((a, b) => b.quantity - a.quantity).slice(0, 5) };
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { Store, STORE_STATE_KEY, STORE_CATEGORIES, ORDER_STATUS_FLOW, nextOrderStatusesFor, refundableStatuses, paginate, matchesQuery, ADMIN_PAGE_SIZE };
