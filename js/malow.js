/* ============================================================
   MALOW LONDON — Main JavaScript v2.0
   ============================================================
   Cart: localStorage prototype — wire to Shopify Ajax Cart in production
     POST /cart/add.js, GET /cart.js, POST /cart/change.js, /checkout
   - Wishlist: replace localStorage with Wishlist Hero app API
   - products.js: replace PRODUCTS object with Liquid product data
   ============================================================ */

'use strict';

let _productCardRevealObserver = null;

/* ─── State (replace with Shopify APIs in production) ────── */
const Malow = {
  cart: JSON.parse(localStorage.getItem('malow-cart') || '[]'),
  wishlist: JSON.parse(localStorage.getItem('malow-wishlist') || '[]'),

  saveCart() {
    localStorage.setItem('malow-cart', JSON.stringify(this.cart));
    this.updateCartUI();
    if (document.getElementById('cart-drawer-body')) renderCartDrawer();
    if (document.getElementById('cart-root')) renderCartPage();
  },

  getCartTotal() {
    return this.cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  },

  getCartCount() {
    return this.cart.reduce((sum, item) => sum + item.qty, 0);
  },

  updateCartUI() {
    const count = this.getCartCount();
    document.querySelectorAll('[data-cart-count]').forEach(el => {
      el.textContent = count > 0 ? String(count) : '';
      el.classList.toggle('nav__cart-count--visible', count > 0);
      el.style.removeProperty('display');
    });
  },

  saveWishlist() {
    localStorage.setItem('malow-wishlist', JSON.stringify(this.wishlist));
    this.updateWishlistUI();
  },

  updateWishlistUI() {
    document.querySelectorAll('[data-wishlist-id]').forEach(btn => {
      const id = btn.dataset.wishlistId;
      const active = Malow.wishlist.includes(id);
      btn.classList.toggle('active', active);
    });
  }
};

/* ─── Shared SVGs ────────────────────────────────────────── */
const HEART_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`;

function shoeIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" fill="none">
    <g opacity="0.38"><path d="M14 52C14 52 19 34 60 32C74 31 76 43 71 50C66 57 48 60 32 63C22 65 16 72 14 75L14 52Z" fill="currentColor"/>
    <path d="M15 73L12 84L21 84L23 73Z" fill="currentColor"/>
    <path d="M52 34L56 22L66 25L62 37Z" fill="currentColor"/></g></svg>`;
}

/* ─── Product Card Builder ───────────────────────────────── */
/* Shared renderer used on homepage, shop-all grid, and also-like */
/* activeFilter: e.g. 'wedding' - uses product.defaultVariantForFilters if set */
function buildProductCard(product, activeFilter) {
  if (!product) return '';
  const filter = activeFilter && activeFilter !== 'all' ? activeFilter : null;
  let vIndex = 0;
  if (filter && product.defaultVariantForFilters && product.defaultVariantForFilters[filter] != null) {
    vIndex = product.defaultVariantForFilters[filter];
  }
  const firstVariant = product.variants[vIndex] || product.variants[0];
  const firstImage   = firstVariant.images[0];
  const categories   = product.categories.join(' ');

  const swatchesHtml = product.variants.length > 1
    ? `<div class="product-card__swatches">
        ${product.variants.map((v, i) => `
          <span class="product-card__swatch${i === vIndex ? ' active' : ''}"
                style="background:${v.swatch};"
                data-img="${v.images[0]}"
                title="${v.label}"
                aria-label="${v.label} colour"></span>
        `).join('')}
       </div>`
    : '';

  return `
    <a class="product-card" href="product.html?id=${product.id}" data-product-id="${product.id}" data-categories="${categories}">
      <div class="product-card__image">
        <img src="${firstImage}" alt="${product.name}" loading="lazy">
        <button type="button" class="product-card__heart" data-wishlist-id="${product.id}" aria-label="Save to favourites">${HEART_SVG}</button>
      </div>
      <div class="product-card__info">
        <p class="product-card__name">${product.name}</p>
        <p class="product-card__price">£${product.price.toFixed(2)}</p>
        ${swatchesHtml}
      </div>
    </a>`;
}

/* Matches IntersectionObserver rootMargin (bottom -6%) so first paint isn’t all hidden */
function isProductCardInitiallyVisible(el) {
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const vw = window.innerWidth || document.documentElement.clientWidth;
  const rootBottom = vh - vh * 0.06;
  return r.top < rootBottom && r.bottom > 32 && r.left < vw && r.right > 0;
}

/* Scroll-triggered fade/slide — product cards only (respects reduced motion) */
function initProductCardScrollReveal() {
  const cards = document.querySelectorAll('.product-card');
  if (!cards.length) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cards.forEach(el => el.classList.add('product-card--inview'));
    return;
  }

  cards.forEach(card => {
    if (isProductCardInitiallyVisible(card)) card.classList.add('product-card--inview');
  });

  document.documentElement.classList.add('js-product-card-reveal');

  _productCardRevealObserver = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('product-card--inview');
        _productCardRevealObserver.unobserve(entry.target);
      });
    },
    { root: null, rootMargin: '0px 0px -6% 0px', threshold: 0.06 }
  );

  cards.forEach(card => {
    if (!card.classList.contains('product-card--inview')) {
      _productCardRevealObserver.observe(card);
    }
  });
}

/* Attach swatch-dot hover/click to a rendered grid container */
function initCardSwatches(container) {
  container.addEventListener('click', e => {
    const swatch = e.target.closest('.product-card__swatch');
    if (!swatch) return;
    e.preventDefault();
    e.stopPropagation();
    const card = swatch.closest('.product-card');
    if (!card) return;
    card.querySelectorAll('.product-card__swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    const img = card.querySelector('.product-card__image img');
    if (img && swatch.dataset.img) img.src = swatch.dataset.img;
  });
}

/* ─── Navigation ─────────────────────────────────────────── */
function initNav() {
  const hamburger  = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('open');
        hamburger.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav__link').forEach(link => {
    const href = (link.getAttribute('href') || '').split('/').pop();
    if (href === currentPage || (currentPage === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
}

/* ─── Cart drawer (prototype; Shopify: cart-drawer.liquid) ─ */
function initCartDrawer() {
  const drawer   = document.getElementById('cart-drawer');
  const overlay  = document.getElementById('cart-overlay');
  const closeBtn = document.getElementById('cart-drawer-close');

  if (!drawer) return;

  function openDrawer() {
    renderCartDrawer();
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('[data-open-cart]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); openDrawer(); });
  });

  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (overlay) overlay.addEventListener('click', closeDrawer);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });
}

function renderCartDrawer() {
  const body     = document.getElementById('cart-drawer-body');
  const subtotal = document.getElementById('cart-drawer-subtotal');
  if (!body) return;

  if (Malow.cart.length === 0) {
    body.innerHTML = `
      <div class="cart-empty">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        <p class="cart-empty__text">Your bag is empty.<br>Discover something beautiful.</p>
        <a href="shop-all.html" class="btn-pill">Shop the Collection</a>
      </div>`;
    if (subtotal) subtotal.textContent = '£0.00';
    return;
  }

  body.innerHTML = Malow.cart.map((item, idx) => `
    <div class="cart-item">
      <div class="cart-item__thumb">
        ${item.image
          ? `<img src="${item.image}" alt="${item.name}" style="width:100%;height:100%;object-fit:contain;">`
          : shoeIcon()}
      </div>
      <div class="cart-item__info">
        <div class="cart-item__name">${item.name}${item.colour ? ` — ${item.colour}` : ''}</div>
        <div class="cart-item__meta">Size ${item.size} · Qty ${item.qty}</div>
        <div class="cart-item__price">£${(item.price * item.qty).toFixed(2)}</div>
        <button type="button" class="cart-item__remove" data-cart-remove="${idx}">Remove</button>
      </div>
    </div>`).join('');

  if (subtotal) subtotal.textContent = `£${Malow.getCartTotal().toFixed(2)}`;

  body.querySelectorAll('[data-cart-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-cart-remove'), 10);
      removeFromCart(i);
    });
  });
}

function removeFromCart(idx) {
  if (idx < 0 || idx >= Malow.cart.length) return;
  Malow.cart.splice(idx, 1);
  Malow.saveCart();
}
window.removeFromCart = removeFromCart;

function addToCart(product) {
  /* Shopify: POST /cart/add.js with { id: variant_id, quantity: 1 } */
  const existing = Malow.cart.find(
    item => item.id === product.id && item.size === product.size && item.colour === product.colour
  );
  if (existing) {
    existing.qty += 1;
  } else {
    Malow.cart.push({ ...product, qty: 1 });
  }
  Malow.saveCart();

  document.querySelectorAll('[data-open-cart] svg').forEach(svg => {
    svg.style.transform = 'scale(1.35)';
    setTimeout(() => { svg.style.transform = ''; }, 280);
  });

  const drawer  = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  if (drawer) {
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function renderCartPage() {
  const root = document.getElementById('cart-root');
  if (!root) return;

  if (Malow.cart.length === 0) {
    root.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
        </svg>
        <p class="empty-state__text">Your bag is empty.<br>Discover something beautiful.</p>
        <a href="shop-all.html" class="btn-pill">Shop the Collection</a>
      </div>`;
    return;
  }

  const qtyTotal = Malow.getCartCount();
  const subtotal = Malow.getCartTotal();

  root.innerHTML = `
    <div class="cart-page__inner">
      <div>
        <div class="cart-table" id="cart-page-items">
          ${Malow.cart.map((item, idx) => `
            <div class="cart-table__row">
              <div class="cart-table__img">
                ${item.image
                  ? `<img src="${item.image}" alt="" style="width:100%;height:100%;object-fit:contain;">`
                  : shoeIcon()}
              </div>
              <div>
                <p class="cart-table__name">${item.name}${item.colour ? ` — ${item.colour}` : ''}</p>
                <p class="cart-table__size">Size ${item.size} · Qty ${item.qty}</p>
                <button type="button" class="cart-item__remove" data-cart-remove="${idx}" style="margin-top:8px;">Remove</button>
              </div>
              <p class="cart-table__price">£${(item.price * item.qty).toFixed(2)}</p>
            </div>`).join('')}
        </div>
        <div style="margin-top:24px;">
          <a href="shop-all.html" class="btn-pill" style="font-size:11px;">← Continue Shopping</a>
        </div>
      </div>
      <div class="order-summary-box">
        <p class="order-summary-box__heading">Order Summary</p>
        <div class="order-summary-box__row">
          <span class="order-summary-box__label">Subtotal (${qtyTotal} item${qtyTotal === 1 ? '' : 's'})</span>
          <span class="order-summary-box__value">£${subtotal.toFixed(2)}</span>
        </div>
        <div class="order-summary-box__row">
          <span class="order-summary-box__label">Shipping</span>
          <span class="order-summary-box__value">Calculated at checkout</span>
        </div>
        <div class="order-summary-box__row">
          <span class="order-summary-box__label">Discount</span>
          <span class="order-summary-box__value">—</span>
        </div>
        <hr class="order-summary-box__divider">
        <div class="order-summary-box__total">
          <span class="order-summary-box__total-label">Total</span>
          <span class="order-summary-box__total-value">£${subtotal.toFixed(2)}</span>
        </div>
        <!-- Shopify: replace with checkout_url or routes.root_url checkout -->
        <a href="/checkout" class="btn-rect">Proceed to Checkout</a>
      </div>
    </div>`;

  root.querySelectorAll('[data-cart-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.getAttribute('data-cart-remove'), 10);
      removeFromCart(i);
    });
  });
}

function initCartPage() {
  renderCartPage();
}

/* ─── Wishlist (event-delegated, safe to call once) ─────── */
/* Shopify: Wishlist Hero app handles this in production      */
let _wishlistInited = false;
function initWishlist() {
  if (!_wishlistInited) {
    _wishlistInited = true;
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-wishlist-id]');
      if (!btn || btn.tagName === 'A') return;
      e.preventDefault();
      e.stopPropagation();
      const id  = btn.dataset.wishlistId;
      const idx = Malow.wishlist.indexOf(id);
      if (idx > -1) {
        Malow.wishlist.splice(idx, 1);
        btn.classList.remove('active');
        const span = btn.querySelector('span');
        if (span) span.textContent = 'Add to Favourites';
      } else {
        Malow.wishlist.push(id);
        btn.classList.add('active');
        const span = btn.querySelector('span');
        if (span) span.textContent = 'Saved to Favourites';
      }
      Malow.saveWishlist();
    });
  }
  Malow.updateWishlistUI();
}

/* ─── About Page Tabs ────────────────────────────────────── */
function initAboutTabs() {
  const tabs   = document.querySelectorAll('.about-tab');
  const panels = document.querySelectorAll('.about-panel');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t  => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(target);
      if (panel) panel.classList.add('active');
    });
  });
}

/* About founder — white panel read more (desktop); full text on narrow viewports */
function initAboutFounderExpand() {
  const panel = document.getElementById('about-founder-panel');
  const rest  = document.getElementById('about-founder-rest');
  const btn   = document.getElementById('about-founder-toggle');
  if (!panel || !rest || !btn) return;

  const mq = window.matchMedia('(max-width: 768px)');

  function applyLayout(isMobile) {
    if (isMobile) {
      rest.removeAttribute('hidden');
      panel.classList.add('about-founder__panel--expanded');
      btn.hidden = true;
      btn.setAttribute('aria-expanded', 'true');
      return;
    }
    btn.hidden = false;
    if (!panel.dataset.aboutExpanded) {
      rest.setAttribute('hidden', '');
      panel.classList.remove('about-founder__panel--expanded');
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'Read full story';
    }
  }

  btn.addEventListener('click', () => {
    const isOpen = panel.classList.contains('about-founder__panel--expanded');
    if (!isOpen) {
      rest.removeAttribute('hidden');
      panel.classList.add('about-founder__panel--expanded');
      btn.setAttribute('aria-expanded', 'true');
      btn.textContent = 'Show less';
      panel.dataset.aboutExpanded = '1';
    } else {
      rest.setAttribute('hidden', '');
      panel.classList.remove('about-founder__panel--expanded');
      btn.setAttribute('aria-expanded', 'false');
      btn.textContent = 'Read full story';
      delete panel.dataset.aboutExpanded;
    }
  });

  applyLayout(mq.matches);
  const onMqChange = () => applyLayout(mq.matches);
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onMqChange);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(onMqChange);
  }
}

/* Update card images to filter-specific default variants (see product.defaultVariantForFilters) */
function syncCollectionGridVariantThumbnails(filter) {
  const grid = document.getElementById('collections-grid');
  if (!grid || typeof PRODUCTS === 'undefined') return;
  grid.querySelectorAll('.product-card[data-product-id]').forEach(card => {
    const id = card.dataset.productId;
    const product = PRODUCTS[id];
    if (!product || !product.variants || !product.variants.length) return;
    let vIndex = 0;
    if (filter && filter !== 'all' && product.defaultVariantForFilters && product.defaultVariantForFilters[filter] != null) {
      vIndex = product.defaultVariantForFilters[filter];
    }
    const v = product.variants[vIndex] || product.variants[0];
    const img = card.querySelector('.product-card__image img');
    if (img && v.images && v.images[0]) img.src = v.images[0];
    card.querySelectorAll('.product-card__swatch').forEach((s, i) => {
      s.classList.toggle('active', i === vIndex);
    });
  });
}

/* ─── Collections Filter ─────────────────────────────────── */
/* Supports multi-category: data-categories="wedding party"  */
function applyCollectionsFilter(filter) {
  document.querySelectorAll('.filter-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.filter === filter);
  });

  const cards = document.querySelectorAll('#collections-grid [data-categories]');
  let visible = 0;
  cards.forEach(card => {
    const cats = (card.dataset.categories || '').split(' ');
    const show = filter === 'all' || cats.includes(filter);
    card.style.display = show ? '' : 'none';
    if (show) visible++;
  });

  const empty = document.getElementById('collections-empty');
  if (empty) empty.style.display = visible === 0 ? 'block' : 'none';

  document.querySelectorAll('#collections-grid .collections-group').forEach(section => {
    const anyShown = [...section.querySelectorAll('.product-card')].some(
      c => c.style.display !== 'none'
    );
    section.style.display = anyShown ? '' : 'none';
  });

  syncCollectionGridVariantThumbnails(filter);
}

function initFilter() {
  const pills = document.querySelectorAll('.filter-pill');
  if (!pills.length) return;

  pills.forEach(pill => {
    pill.addEventListener('click', () => applyCollectionsFilter(pill.dataset.filter));
  });
}

/* ─── Render Collections Grid (shop-all.html) ────────────── */
function renderCollectionsGrid() {
  const grid = document.getElementById('collections-grid');
  if (!grid || typeof PRODUCTS === 'undefined') return;

  const urlFilter = new URLSearchParams(window.location.search).get('filter') || 'all';

  const groups =
    typeof SHOP_ALL_GROUPS !== 'undefined' && SHOP_ALL_GROUPS.length
      ? SHOP_ALL_GROUPS
      : [{ ids: PRODUCTS_LIST }];

  grid.classList.add('collections-groups');
  grid.innerHTML = groups
    .map(group => {
      const cards = group.ids
        .map(id => (PRODUCTS[id] ? buildProductCard(PRODUCTS[id], urlFilter) : ''))
        .join('');
      if (!cards) return '';
      return `<section class="collections-group"><div class="product-grid collections-group__grid">${cards}</div></section>`;
    })
    .join('');

  initCardSwatches(grid);
  initFilter();
  initWishlist();

  /* Auto-apply ?filter= from URL when pills absent (e.g. shop-all.html?filter=wedding) */
  if (urlFilter && urlFilter !== 'all') {
    const matchPill = document.querySelector(`.filter-pill[data-filter="${urlFilter}"]`);
    if (matchPill) matchPill.click();
    else applyCollectionsFilter(urlFilter);
  } else {
    syncCollectionGridVariantThumbnails('all');
  }
}

/* ─── Render Homepage Products (index.html) ──────────────── */
function renderHomepageProducts() {
  if (typeof PRODUCTS === 'undefined') return;

  const shopAllGrid = document.getElementById('shop-all-grid');
  if (shopAllGrid) {
    shopAllGrid.innerHTML = PRODUCTS_LIST.slice(0, 8).map(id => buildProductCard(PRODUCTS[id])).join('');
    initCardSwatches(shopAllGrid);
  }

  /* About page shop teaser - 4 bestsellers */
  const aboutShopGrid = document.getElementById('about-shop-grid');
  if (aboutShopGrid) {
    const picks = PRODUCTS_LIST.filter(id => PRODUCTS[id] && PRODUCTS[id].bestseller).slice(0, 4);
    const fill  = picks.length < 4 ? PRODUCTS_LIST.filter(id => !picks.includes(id)).slice(0, 4 - picks.length) : [];
    aboutShopGrid.innerHTML = [...picks, ...fill].map(id => buildProductCard(PRODUCTS[id])).join('');
    initCardSwatches(aboutShopGrid);
  }

  initWishlist();
}

/* ─── Dynamic Product Page ───────────────────────────────── */
function initDynamicProduct() {
  const inner = document.getElementById('product-page-inner');
  if (!inner || typeof PRODUCTS === 'undefined') return;

  const params    = new URLSearchParams(window.location.search);
  const productId = params.get('id');
  const product   = productId ? PRODUCTS[productId] : null;

  if (!product) {
    inner.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:80px 0;">
        <p style="font-size:15px;font-weight:400;color:var(--sunday-slate);margin-bottom:28px;">Product not found.</p>
        <a href="shop-all.html" class="btn-pill">View All Styles</a>
      </div>`;
    return;
  }

  document.title = `${product.name} - MALOW LONDON`;

  const bcEl = document.getElementById('breadcrumb-product');
  if (bcEl) bcEl.textContent = product.name;

  let activeVariantIdx = 0;

  function getMainImg()  { return document.getElementById('prod-main-img'); }
  function getThumbsEl() { return document.getElementById('prod-thumbs'); }

  function renderGallery(variantIdx) {
    const variant  = product.variants[variantIdx];
    const mainImg  = getMainImg();
    if (mainImg) {
      mainImg.src = variant.images[0];
      mainImg.alt = `${product.name} - ${variant.label}`;
    }
    const thumbsEl = getThumbsEl();
    if (!thumbsEl) return;
    thumbsEl.innerHTML = variant.images.map((src, i) => `
      <div class="product-gallery__thumb${i === 0 ? ' active' : ''}"
           data-img="${src}" role="button" tabindex="0"
           aria-label="View angle ${i + 1}">
        <img src="${src}" alt="${product.name} angle ${i + 1}" loading="lazy">
      </div>`).join('');

    thumbsEl.querySelectorAll('.product-gallery__thumb').forEach(thumb => {
      thumb.addEventListener('click', () => {
        thumbsEl.querySelectorAll('.product-gallery__thumb').forEach(t => t.classList.remove('active'));
        thumb.classList.add('active');
        const mi = getMainImg();
        if (mi) mi.src = thumb.dataset.img;
      });
      thumb.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); thumb.click(); }
      });
    });
  }

  inner.innerHTML = `
    <!-- Gallery -->
    <div class="product-gallery" aria-label="Product images">
      <div class="product-gallery__main">
        <img id="prod-main-img" src="" alt="" style="width:100%;height:100%;object-fit:contain;">
      </div>
      <div class="product-gallery__thumbs" id="prod-thumbs"></div>
    </div>

    <!-- Info -->
    <div class="product-info">
      <h1 class="product-info__name">${product.name}</h1>
      <p class="product-info__price">£${product.price.toFixed(2)}</p>

      <p class="product-info__label">Colour - <span id="active-colour-name">${product.variants[0].label}</span></p>
      <div class="colour-selector" id="colour-selector">
        ${product.variants.map((v, i) => `
          <button class="colour-swatch-btn${i === 0 ? ' active' : ''}"
                  data-variant="${i}"
                  style="--swatch-color:${v.swatch};"
                  title="${v.label}"
                  aria-label="${v.label} colour"></button>`).join('')}
      </div>

      <p class="product-info__label">Select Size</p>
      <div class="size-selector" role="group" aria-label="Size selection">
        ${product.sizes.map(s => `<button class="size-btn" data-size="${s}" aria-label="Size ${s}">${s}</button>`).join('')}
      </div>

      <div class="product-info__add-wrap">
        <button type="button" class="btn-rect" id="add-to-bag-btn">Add to Bag</button>
      </div>

      <button class="product-info__wishlist-btn" id="product-wishlist-btn"
              data-wishlist-id="${product.id}" aria-label="Add to favourites">
        ${HEART_SVG}
        <span>Add to Favourites</span>
      </button>

      <div class="accordion">
        <div class="accordion-item">
          <button class="accordion-toggle" aria-expanded="false">
            Details
            <span class="accordion-toggle__icon" aria-hidden="true">+</span>
          </button>
          <div class="accordion-body">
            <p>${product.description}</p>
            <br>
            <ul style="padding-left:0;list-style:none;">
              ${product.details.map(d => `<li style="margin-bottom:6px;">· ${d}</li>`).join('')}
            </ul>
          </div>
        </div>
        <div class="accordion-item">
          <button class="accordion-toggle" aria-expanded="false">
            Size Guide
            <span class="accordion-toggle__icon" aria-hidden="true">+</span>
          </button>
          <div class="accordion-body">
            <p>MALOW heels are true to size.</p>
            <br>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;font-weight:400;color:var(--text-muted);">
                <thead><tr style="border-bottom:1px solid var(--rosy-blush);">
                  <th style="text-align:left;padding:8px 0;font-weight:400;letter-spacing:1px;text-transform:uppercase;font-size:10px;">UK</th>
                  <th style="text-align:left;padding:8px 0;font-weight:400;letter-spacing:1px;text-transform:uppercase;font-size:10px;">EU</th>
                  <th style="text-align:left;padding:8px 0;font-weight:400;letter-spacing:1px;text-transform:uppercase;font-size:10px;">US</th>
                </tr></thead>
                <tbody>
                  <tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px 0;">3</td><td style="padding:8px 0;">36</td><td style="padding:8px 0;">5.5</td></tr>
                  <tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px 0;">4</td><td style="padding:8px 0;">37</td><td style="padding:8px 0;">6.5</td></tr>
                  <tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px 0;">5</td><td style="padding:8px 0;">38</td><td style="padding:8px 0;">7.5</td></tr>
                  <tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px 0;">6</td><td style="padding:8px 0;">39</td><td style="padding:8px 0;">8.5</td></tr>
                  <tr style="border-bottom:1px solid var(--border-subtle);"><td style="padding:8px 0;">7</td><td style="padding:8px 0;">40</td><td style="padding:8px 0;">9.5</td></tr>
                  <tr><td style="padding:8px 0;">8</td><td style="padding:8px 0;">41</td><td style="padding:8px 0;">10.5</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  renderGallery(0);

  /* Colour swatch switching */
  document.querySelectorAll('.colour-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.variant, 10);
      document.querySelectorAll('.colour-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeVariantIdx = idx;
      renderGallery(idx);
      const colourName = document.getElementById('active-colour-name');
      if (colourName) colourName.textContent = product.variants[idx].label;
    });
  });

  /* Size selector + Add to Bag */
  const sizeBtns = document.querySelectorAll('.size-btn');
  let selectedSize = null;
  sizeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      sizeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedSize = btn.dataset.size;
    });
  });

  const addBtn = document.getElementById('add-to-bag-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (!selectedSize) {
        const orig = addBtn.textContent;
        addBtn.textContent = 'Please select a size';
        addBtn.style.background = 'var(--warm-linen)';
        setTimeout(() => { addBtn.textContent = orig; addBtn.style.background = ''; }, 2000);
        return;
      }
      const v = product.variants[activeVariantIdx] || product.variants[0];
      addToCart({
        id: product.id,
        name: product.name,
        price: product.price,
        size: selectedSize,
        colour: v.label,
        image: v.images[0]
      });
      const orig = addBtn.textContent;
      addBtn.textContent = 'Added to Bag ✓';
      addBtn.style.background = 'var(--warm-linen)';
      setTimeout(() => { addBtn.textContent = orig; addBtn.style.background = ''; }, 1800);
    });
  }

  /* Accordion */
  initAccordion();

  /* Wishlist */
  initWishlist();
  const wBtn = document.getElementById('product-wishlist-btn');
  if (wBtn && Malow.wishlist.includes(product.id)) {
    wBtn.classList.add('active');
    const span = wBtn.querySelector('span');
    if (span) span.textContent = 'Saved to Favourites';
  }

  /* "You may also like" */
  const alsoLikeGrid = document.getElementById('also-like-grid');
  if (alsoLikeGrid && typeof PRODUCTS_LIST !== 'undefined') {
    const others = PRODUCTS_LIST.filter(id => id !== productId).slice(0, 4);
    alsoLikeGrid.innerHTML = others.map(id => buildProductCard(PRODUCTS[id])).join('');
    initCardSwatches(alsoLikeGrid);
  }
}

/* ─── Accordion ──────────────────────────────────────────── */
function initAccordion() {
  document.querySelectorAll('.accordion-toggle').forEach(toggle => {
    if (toggle._accordionInited) return;
    toggle._accordionInited = true;
    toggle.addEventListener('click', () => {
      const isOpen = toggle.classList.contains('open');
      document.querySelectorAll('.accordion-toggle').forEach(t => t.classList.remove('open'));
      document.querySelectorAll('.accordion-body').forEach(b  => b.classList.remove('open'));
      if (!isOpen) {
        toggle.classList.add('open');
        const body = toggle.nextElementSibling;
        if (body && body.classList.contains('accordion-body')) body.classList.add('open');
      }
    });
  });
}

/* ─── Email Newsletter Form ──────────────────────────────── */
function initEmailForms() {
  document.querySelectorAll('[data-email-form]').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const btn   = form.querySelector('button[type="submit"]');
      const email = input ? input.value.trim() : '';
      if (!email || !email.includes('@')) {
        if (input) input.style.borderColor = 'var(--vintage-pink)';
        setTimeout(() => { if (input) input.style.borderColor = ''; }, 2000);
        return;
      }
      if (btn)   btn.textContent = 'Thank you!';
      if (input) { input.value = ''; input.placeholder = 'You\'re on the list!'; }
      setTimeout(() => {
        if (btn)   btn.textContent = 'Submit';
        if (input) input.placeholder = 'Email address';
      }, 4000);
    });
  });
}

/* ─── Favourites Page ────────────────────────────────────── */
function initFavouritesPage() {
  const grid  = document.getElementById('favourites-grid');
  const empty = document.getElementById('favourites-empty');
  if (!grid || !empty) return;

  if (Malow.wishlist.length === 0) {
    grid.style.display  = 'none';
    empty.style.display = 'block';
  } else {
    grid.style.display  = '';
    empty.style.display = 'none';

    if (typeof PRODUCTS !== 'undefined') {
      grid.innerHTML = Malow.wishlist
        .filter(id => PRODUCTS[id])
        .map(id => buildProductCard(PRODUCTS[id]))
        .join('');
      if (grid.innerHTML) {
        initCardSwatches(grid);
      } else {
        grid.style.display  = 'none';
        empty.style.display = 'block';
      }
    } else {
      grid.innerHTML = `
        <p style="font-size:13px;font-weight:400;color:var(--sunday-slate);text-align:center;padding:24px 0;grid-column:1/-1;">
          ${Malow.wishlist.length} saved style${Malow.wishlist.length > 1 ? 's' : ''}.
        </p>`;
    }
  }
}

/* ─── Init ───────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initCartDrawer();
  initWishlist();
  initAboutTabs();
  initAboutFounderExpand();
  renderCollectionsGrid();
  renderHomepageProducts();
  initDynamicProduct();
  initAccordion();
  initEmailForms();
  initFavouritesPage();
  initCartPage();

  Malow.updateCartUI();
  Malow.updateWishlistUI();

  initProductCardScrollReveal();
});
