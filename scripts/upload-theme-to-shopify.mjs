#!/usr/bin/env node
/**
 * Upload all MALOW Liquid theme files to the active Shopify theme.
 *
 * Usage:
 *   node scripts/upload-theme-to-shopify.mjs
 *
 * Reads credentials from .env (SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN or CLIENT_ID+SECRET)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Load .env ────────────────────────────────────────────────────────────────
const envPath = path.join(ROOT, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
  });
}

const SHOP    = env.SHOPIFY_SHOP || process.env.SHOPIFY_SHOP;
const TOKEN   = env.SHOPIFY_ADMIN_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN;
const CLIENT_ID     = env.SHOPIFY_CLIENT_ID     || process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = env.SHOPIFY_CLIENT_SECRET || process.env.SHOPIFY_CLIENT_SECRET;

if (!SHOP) { console.error('SHOPIFY_SHOP not set in .env'); process.exit(1); }
if (!TOKEN && !(CLIENT_ID && CLIENT_SECRET)) {
  console.error('Need SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in .env');
  process.exit(1);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
let _cachedToken = TOKEN || null;

async function getAccessToken() {
  if (_cachedToken) return _cachedToken;
  const res = await fetch(
    `https://${SHOP}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'client_credentials',
      }).toString(),
    }
  );
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OAuth failed (${res.status}): ${txt}`);
  }
  const data = await res.json();
  _cachedToken = data.access_token;
  return _cachedToken;
}

// ─── REST API ─────────────────────────────────────────────────────────────────
async function shopifyGet(path_) {
  const tok = await getAccessToken();
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/2025-01${path_}`, {
    headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path_} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function shopifyPut(path_, body) {
  const tok = await getAccessToken();
  const res = await fetch(`https://${SHOP}.myshopify.com/admin/api/2025-01${path_}`, {
    method: 'PUT',
    headers: { 'X-Shopify-Access-Token': tok, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path_} → ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Get active theme ─────────────────────────────────────────────────────────
async function getActiveThemeId() {
  const data = await shopifyGet('/themes.json');
  const active = data.themes.find(t => t.role === 'main');
  if (!active) throw new Error('No main/active theme found');
  return active.id;
}

// ─── Upload asset ─────────────────────────────────────────────────────────────
async function uploadAsset(themeId, key, content, isBinary = false) {
  const body = { asset: { key } };
  if (isBinary) {
    body.asset.attachment = Buffer.isBuffer(content) ? content.toString('base64') : content;
  } else {
    body.asset.value = content;
  }
  await shopifyPut(`/themes/${themeId}/assets.json`, body);
}

// ─── Collect files to upload ──────────────────────────────────────────────────
const THEME_DIR = path.join(ROOT, 'theme');

// Extra files outside the theme/ folder that must be mapped to a Shopify asset key
const EXTRA_FILES = [
  { fullPath: path.join(ROOT, 'css', 'malow.css'), key: 'assets/malow-custom.css' },
];

function collectFiles(dir) {
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else {
      // Shopify asset key = relative path from theme dir, using forward slashes
      const key = path.relative(THEME_DIR, fullPath).replace(/\\/g, '/');
      files.push({ fullPath, key });
    }
  }
  return files;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Connecting to ${SHOP}.myshopify.com…`);
  const themeId = await getActiveThemeId();
  console.log(`Active theme ID: ${themeId}`);

  const files = [...collectFiles(THEME_DIR), ...EXTRA_FILES];
  console.log(`Found ${files.length} theme files to upload\n`);

  let uploaded = 0;
  let failed = 0;

  for (const { fullPath, key } of files) {
    const ext = path.extname(key).toLowerCase();
    const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.eot'].includes(ext);

    try {
      const content = isBinary ? fs.readFileSync(fullPath) : fs.readFileSync(fullPath, 'utf8');
      await uploadAsset(themeId, key, content, isBinary);
      console.log(`  ✓ ${key}`);
      uploaded++;

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 250));
    } catch (err) {
      console.error(`  ✗ ${key}: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Uploaded: ${uploaded} | Failed: ${failed}`);
  if (failed === 0) {
    console.log('\n✅ All files uploaded! Visit your store to preview:');
    console.log(`   https://${SHOP}.myshopify.com`);
  } else {
    console.log('\n⚠️  Some files failed. Check errors above and retry.');
  }
}

main().catch(e => {
  console.error(e.message || e);
  process.exit(1);
});
