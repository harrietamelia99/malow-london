/**
 * MALOW London — Cart Drawer
 * Handles the sliding cart drawer, live cart updates, and quantity controls.
 */
(function () {
  'use strict';

  const drawer = document.getElementById('cart-drawer');
  const overlay = document.getElementById('cart-overlay');
  const openBtn = document.getElementById('malow-cart-open');
  const closeBtn = document.getElementById('cart-drawer-close');
  const body = document.getElementById('cart-drawer-body');
  const subtotal = document.getElementById('cart-drawer-subtotal');
  const countEl = document.getElementById('malow-cart-count');

  if (!drawer) return;

  // Expose open method for product page
  window.malowCart = { open: openDrawer, refresh: refreshCart };

  function openDrawer() {
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('open');
    document.body.classList.add('cart-drawer-is-open');
    refreshCart();
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
    document.body.classList.remove('cart-drawer-is-open');
  }

  if (openBtn) openBtn.addEventListener('click', openDrawer);
  if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
  if (overlay) overlay.addEventListener('click', closeDrawer);

  // Close on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer();
  });

  function money(cents) {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(cents / 100);
  }

  function refreshCart() {
    fetch('/cart.js', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
      .then(r => r.json())
      .then(cart => {
        renderCart(cart);
        updateCount(cart.item_count);
      });
  }

  function updateCount(count) {
    if (!countEl) return;
    countEl.textContent = count;
    countEl.style.display = count > 0 ? '' : 'none';
    if (openBtn) openBtn.setAttribute('aria-label', 'Shopping bag (' + count + ' item' + (count !== 1 ? 's' : '') + ')');
  }

  function renderCart(cart) {
    if (!body) return;

    if (subtotal) subtotal.textContent = money(cart.total_price);

    if (cart.item_count === 0) {
      body.innerHTML = '<p class="cart-drawer__empty">Your bag is empty.</p>';
      return;
    }

    const html = cart.items.map(item => `
      <div class="cart-item" data-key="${item.key}">
        <a href="${item.url}" class="cart-item__image-link">
          ${item.image ? `<img src="${item.image.replace('.jpg', '_160x.jpg').replace('.png', '_160x.png')}" alt="${escapeHtml(item.title)}" class="cart-item__img" width="80" height="80" loading="lazy">` : ''}
        </a>
        <div class="cart-item__info">
          <a href="${item.url}" class="cart-item__title">${escapeHtml(item.product_title)}</a>
          ${item.variant_title && item.variant_title !== 'Default Title' ? `<p class="cart-item__variant">${escapeHtml(item.variant_title)}</p>` : ''}
          <p class="cart-item__price">${money(item.final_line_price)}</p>
          <div class="cart-item__qty-row">
            <button class="cart-item__qty-btn" data-action="decrease" data-key="${item.key}" aria-label="Decrease quantity">−</button>
            <span class="cart-item__qty">${item.quantity}</span>
            <button class="cart-item__qty-btn" data-action="increase" data-key="${item.key}" aria-label="Increase quantity">+</button>
            <button class="cart-item__remove" data-key="${item.key}" aria-label="Remove ${escapeHtml(item.title)}">Remove</button>
          </div>
        </div>
      </div>
    `).join('');

    body.innerHTML = html;
    bindCartItemEvents();
  }

  function bindCartItemEvents() {
    body.querySelectorAll('.cart-item__qty-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        const key = this.dataset.key;
        const action = this.dataset.action;
        const row = this.closest('.cart-item');
        const qtyEl = row.querySelector('.cart-item__qty');
        let qty = parseInt(qtyEl.textContent);
        qty = action === 'increase' ? qty + 1 : Math.max(0, qty - 1);
        updateItem(key, qty);
      });
    });

    body.querySelectorAll('.cart-item__remove').forEach(btn => {
      btn.addEventListener('click', function () {
        updateItem(this.dataset.key, 0);
      });
    });
  }

  function updateItem(key, quantity) {
    fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ id: key, quantity })
    })
      .then(r => r.json())
      .then(cart => {
        renderCart(cart);
        updateCount(cart.item_count);
      });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Initial count from page load (SSR)
  document.addEventListener('DOMContentLoaded', function () {
    const count = parseInt((countEl && countEl.textContent) || '0');
    updateCount(count);
  });

  // Listen for Horizon's cart:updated event (if product page uses Horizon's form)
  document.addEventListener('cart:updated', refreshCart);

})();
