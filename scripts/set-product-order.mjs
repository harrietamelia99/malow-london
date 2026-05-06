#!/usr/bin/env node
/**
 * Creates (or updates) a manual "Shop All" custom collection and adds every
 * product to it in the order defined in VERCEL_ORDER.
 * Usage: node scripts/set-product-order.mjs
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

/* ── Order from Vercel's SHOP_ALL_GROUPS ───────────────────────────────── */
const VERCEL_ORDER = [
  'lana', 'chloe', 'bella', 'sabrina',
  'molly', 'millie', 'taylor', 'ava',
  'jenna', 'camila', 'selena', 'olivia',
];

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
async function api(method, endpoint, body) {
  const tok = await getToken();
  const r = await fetch(base + endpoint, {
    method,
    headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${endpoint} → ${r.status}: ${await r.text()}`);
  return r.json();
}

const sleep = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  console.log(`Connecting to ${SHOP}.myshopify.com…\n`);

  // 1. Get or create the custom "Shop All" collection
  const { custom_collections } = await api('GET', '/custom_collections.json?limit=250');
  let collection = custom_collections.find(c => c.handle === 'shop-all');

  if (!collection) {
    const res = await api('POST', '/custom_collections.json', {
      custom_collection: {
        title: 'Shop All',
        handle: 'shop-all',
        sort_order: 'manual',
        published: true,
      }
    });
    collection = res.custom_collection;
    console.log(`  ✓ Created collection "Shop All" (id: ${collection.id})`);
  } else {
    // Ensure sort_order is manual
    await api('PUT', `/custom_collections/${collection.id}.json`, {
      custom_collection: { id: collection.id, sort_order: 'manual' }
    });
    console.log(`  – Using existing collection "Shop All" (id: ${collection.id})`);
  }
  await sleep(400);

  // 2. Fetch all products
  const { products } = await api('GET', '/products.json?limit=250&fields=id,handle,title');
  const byHandle = {};
  products.forEach(p => { byHandle[p.handle] = p; });
  console.log(`  Found ${products.length} products\n`);

  // 3. Remove any existing collects from this collection so we can re-add in order
  const { collects: existing } = await api('GET', `/collects.json?collection_id=${collection.id}&limit=250`);
  for (const c of existing) {
    await api('DELETE', `/collects/${c.id}.json`);
    await sleep(400);
  }

  // 4. Add products in Vercel order; any extras go at the end
  const ordered = VERCEL_ORDER
    .map(handle => byHandle[handle])
    .filter(Boolean);

  const extras = products.filter(p => !VERCEL_ORDER.includes(p.handle));
  const all = [...ordered, ...extras];

  for (let i = 0; i < all.length; i++) {
    const product = all[i];
    await api('POST', '/collects.json', {
      collect: { product_id: product.id, collection_id: collection.id, position: i + 1 }
    });
    console.log(`  ✓ [${i + 1}] ${product.title}`);
    await sleep(400);
  }

  console.log(`\n✅ Done! Collection live at:\n   https://${SHOP}.myshopify.com/collections/shop-all`);
  console.log(`\n   Collection ID: ${collection.id} — use this in the homepage section settings.`);
})().catch(e => { console.error(e.message); process.exit(1); });
