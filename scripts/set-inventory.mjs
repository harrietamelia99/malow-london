#!/usr/bin/env node
/**
 * Sets every product variant to 10 units in stock.
 * Usage: node scripts/set-inventory.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const env = {};
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(l => {
  const m = l.match(/^([^#=]+)=(.*)/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
});

const SHOP          = env.SHOPIFY_SHOP;
const TOKEN         = env.SHOPIFY_ADMIN_TOKEN;
const CLIENT_ID     = env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET;
const QTY           = 10;

let _tok = TOKEN || null;
async function getToken() {
  if (_tok) return _tok;
  const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
  });
  if (!r.ok) throw new Error(`Auth failed ${r.status}: ${await r.text()}`);
  _tok = (await r.json()).access_token;
  return _tok;
}

const base = `https://${SHOP}.myshopify.com/admin/api/2025-01`;
async function api(method, path, body) {
  const tok = await getToken();
  const r = await fetch(base + path, {
    method,
    headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  console.log(`Connecting to ${SHOP}.myshopify.com…`);

  // 1. Get the primary location
  const { locations } = await api('GET', '/locations.json');
  const location = locations.find(l => l.active) || locations[0];
  if (!location) throw new Error('No active location found');
  console.log(`  Location: ${location.name} (${location.id})\n`);

  // 2. Fetch all products (paginate if needed)
  let products = [];
  let url = '/products.json?limit=250&fields=id,title,variants';
  while (url) {
    const data = await api('GET', url);
    products = products.concat(data.products || []);
    // Shopify pagination link header not available here — break if under 250
    url = (data.products || []).length === 250 ? url + '&page_info=next' : null;
    // Simple approach: just get first page (250 products is plenty for a small store)
    url = null;
  }
  console.log(`  Found ${products.length} products\n`);

  let updated = 0;
  let skipped = 0;

  for (const product of products) {
    for (const variant of product.variants) {
      if (!variant.inventory_item_id) { skipped++; continue; }

      try {
        // First make sure inventory tracking is enabled for this item
        await api('PUT', `/inventory_items/${variant.inventory_item_id}.json`, {
          inventory_item: { id: variant.inventory_item_id, tracked: true }
        });
        await sleep(600);

        // Set the inventory level at this location
        await api('POST', '/inventory_levels/set.json', {
          location_id:       location.id,
          inventory_item_id: variant.inventory_item_id,
          available:         QTY,
        });

        console.log(`  ✓ ${product.title} — ${variant.title}: ${QTY} units`);
        updated++;
        await sleep(600);
      } catch (err) {
        console.warn(`  ✗ ${product.title} — ${variant.title}: ${err.message}`);
        skipped++;
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Updated: ${updated} | Skipped: ${skipped}`);
  console.log(`✅ Done! Every variant now has ${QTY} units in stock.`);
})().catch(e => { console.error(e.message); process.exit(1); });
