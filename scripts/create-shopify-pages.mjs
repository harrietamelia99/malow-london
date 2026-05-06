#!/usr/bin/env node
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

let _tok = TOKEN || null;
async function getToken() {
  if (_tok) return _tok;
  const r = await fetch(`https://${SHOP}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
  });
  if (!r.ok) throw new Error(`Auth failed ${r.status}: ${await r.text()}`);
  const d = await r.json();
  _tok = d.access_token;
  return _tok;
}

const base = () => `https://${SHOP}.myshopify.com/admin/api/2025-01`;

async function api(method, endpoint, body) {
  const tok = await getToken();
  const r = await fetch(base() + endpoint, {
    method,
    headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!r.ok) throw new Error(`${method} ${endpoint} → ${r.status}: ${await r.text()}`);
  return r.json();
}

const PAGES = [
  {
    title: 'About Us',
    handle: 'about-us',
    template_suffix: 'about-us',
    body_html: '<p>MALOW London — made for moments that matter.</p>',
  },
  { title: 'Size Guide',         handle: 'size-guide', template_suffix: 'size-guide', body_html: '' },
  { title: 'Shipping & Returns', handle: 'shipping',   template_suffix: 'shipping',   body_html: '' },
  { title: 'Favourites',         handle: 'favourites',     template_suffix: 'favourites',     body_html: '' },
  { title: 'Cookies Policy',    handle: 'cookies-policy', template_suffix: 'cookies-policy', body_html: '' },
];

(async () => {
  console.log(`Connecting to ${SHOP}.myshopify.com…`);

  const existing = await api('GET', '/pages.json?limit=250');
  const byHandle = {};
  (existing.pages || []).forEach(p => { byHandle[p.handle] = p; });

  for (const page of PAGES) {
    if (byHandle[page.handle]) {
      const existing = byHandle[page.handle];
      if (existing.template_suffix !== page.template_suffix) {
        const u = await api('PUT', `/pages/${existing.id}.json`, { page: { template_suffix: page.template_suffix } });
        console.log(`  ✓ Updated template on "${page.handle}" → ${u.page.template_suffix}`);
      } else {
        console.log(`  – Already exists: "${page.handle}" (template: ${existing.template_suffix || 'default'})`);
      }
    } else {
      const c = await api('POST', '/pages.json', { page });
      console.log(`  ✓ Created "${c.page.handle}" | template: page.${c.page.template_suffix} | /pages/${c.page.handle}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\nAll done! Your pages are live at:');
  PAGES.forEach(p => console.log(`  https://${SHOP}.myshopify.com/pages/${p.handle}`));
})().catch(e => { console.error(e.message); process.exit(1); });
