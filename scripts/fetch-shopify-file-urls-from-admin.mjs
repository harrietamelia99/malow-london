#!/usr/bin/env node
/**
 * Bulk-fetch CDN URLs for everything in Content → Files via the Admin GraphQL API,
 * then write shopify-image-urls.json (gitignored) keyed like js/products.js paths.
 *
 * Avoids copying “Copy link” for hundreds of files. Needs scope **read_files**.
 *
 * Auth (pick one):
 *
 * A) Dev Dashboard app — client credentials (Shopify’s current default; token auto-refreshes):
 *    SHOPIFY_SHOP              — store subdomain only (**malow-london**) OR full host (**malow-london.myshopify.com**)
 *    SHOPIFY_CLIENT_ID         — from Dev Dashboard → your app → Settings
 *    SHOPIFY_CLIENT_SECRET     — same
 *
 * B) Legacy Admin token (if you still have one):
 *    SHOPIFY_SHOP              — as above
 *    SHOPIFY_ADMIN_TOKEN       — Admin API access token
 *
 * Optional: SHOPIFY_API_VERSION (default 2025-01)
 *
 * Client credentials only work when the app and store are in the **same Shopify org**
 * (see Shopify doc “shop_not_permitted”). Otherwise use a Dev Dashboard dev store or OAuth.
 *
 * Usage:
 *   SHOPIFY_SHOP=malow-london SHOPIFY_CLIENT_ID=… SHOPIFY_CLIENT_SECRET=… node scripts/fetch-shopify-file-urls-from-admin.mjs
 *
 * Or create **.env** in the project root (copy from **.env.example**). Git ignores `.env`, so some editors hide it unless you enable “show excluded files”.
 *
 * Then:
 *   node scripts/export-shopify-products-csv.mjs
 *
 * Matching: each catalogue path uses the same filename rules as build-shopify-image-urls.mjs
 * (.png→.jpg, _PU_copy→_copy) and looks up Files by URL basename (case-insensitive).
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

loadEnvFromFile(path.join(ROOT, '.env'));

const SHOP_RAW = process.env.SHOPIFY_SHOP || '';
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

/** Load KEY=value lines from .env into process.env (does not override existing vars). */
function loadEnvFromFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

/** Subdomain only, e.g. malow-london */
function shopSubdomain(raw) {
  let s = raw.replace(/^https?:\/\//i, '').replace(/\/$/, '').trim();
  if (!s) return '';
  if (/\.myshopify\.com$/i.test(s)) return s.replace(/\.myshopify\.com$/i, '');
  return s;
}

const SHOP_SUB = shopSubdomain(SHOP_RAW);
const SHOP_HOST = SHOP_SUB ? `${SHOP_SUB}.myshopify.com` : '';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (ADMIN_TOKEN) return ADMIN_TOKEN;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error(
      'Set SHOPIFY_ADMIN_TOKEN or (SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET). See script header.'
    );
  }

  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

  const res = await fetch(`https://${SHOP_HOST}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const hint =
      body.error === 'shop_not_permitted' || String(body.error_description || '').includes('shop_not_permitted')
        ? ' App/store must be in the same Shopify org (Dev Dashboard). See https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens'
        : '';
    throw new Error(`Token request failed HTTP ${res.status}: ${JSON.stringify(body)}${hint}`);
  }

  const { access_token, expires_in } = body;
  if (!access_token) throw new Error(`No access_token in response: ${JSON.stringify(body)}`);

  cachedToken = access_token;
  cachedTokenExpiresAt = Date.now() + Number(expires_in || 86400) * 1000;
  return cachedToken;
}

const OUT_PATH = path.join(ROOT, 'shopify-image-urls.json');

const FILES_QUERY = `#graphql
query Files($cursor: String) {
  files(first: 250, after: $cursor, sortKey: ID) {
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      __typename
      ... on MediaImage {
        image {
          url
        }
      }
      ... on GenericFile {
        url
      }
    }
  }
}
`;

function loadProducts() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'products.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\nvar __EXPORT = PRODUCTS;\nvar __LIST = PRODUCTS_LIST;`, ctx);
  return { PRODUCTS: ctx.__EXPORT, PRODUCTS_LIST: ctx.__LIST };
}

function localPathToShopifyFilename(localPath) {
  let name = path.basename(localPath);
  name = name.replace(/\.png$/i, '.jpg');
  name = name.replace(/_PU_copy/gi, '_copy');
  return name;
}

function isCatalogueProductImagePath(norm) {
  const base = path.basename(norm);
  if (/^about-/i.test(base)) return false;
  if (/\.svg$/i.test(base)) return false;
  return true;
}

function collectImagePaths(PRODUCTS, PRODUCTS_LIST) {
  const set = new Set();
  for (const id of PRODUCTS_LIST) {
    const p = PRODUCTS[id];
    if (!p?.variants) continue;
    for (const col of p.variants) {
      for (const rel of col.images || []) {
        const norm = rel.replace(/^\//, '');
        if (!isCatalogueProductImagePath(norm)) continue;
        set.add(norm);
      }
    }
  }
  return [...set].sort();
}

function basenameFromFileUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const seg = u.pathname.split('/').filter(Boolean);
    const last = seg[seg.length - 1] || '';
    return decodeURIComponent(last.split('?')[0] || '');
  } catch {
    return '';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * If a filename looks like "ORIGINAL_BASENAME_EXTRA-UUID.ext" (a Shopify
 * deduplication rename), return the canonical "ORIGINAL_BASENAME.ext".
 * Otherwise return null.
 */
function stripTrailingUuid(basename) {
  const dot = basename.lastIndexOf('.');
  const stem = dot >= 0 ? basename.slice(0, dot) : basename;
  const ext  = dot >= 0 ? basename.slice(dot)   : '';
  const under = stem.lastIndexOf('_');
  if (under < 0) return null;
  const suffix = stem.slice(under + 1);
  if (!UUID_RE.test(suffix)) return null;
  return stem.slice(0, under) + ext;
}

async function graphql(variables) {
  const token = await getAccessToken();
  const endpoint = `https://${SHOP_HOST}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query: FILES_QUERY, variables }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join('; '));
  }
  return body.data;
}

function collectUrlsFromNodes(nodes) {
  const urls = [];
  for (const node of nodes || []) {
    if (!node) continue;
    let url = '';
    if (node.__typename === 'MediaImage' && node.image?.url) url = node.image.url;
    else if (node.__typename === 'GenericFile' && node.url) url = node.url;
    if (url && /^https?:\/\//i.test(url)) urls.push(url);
  }
  return urls;
}

async function main() {
  if (!SHOP_SUB) {
    console.error('Set SHOPIFY_SHOP to your store subdomain (e.g. malow-london) or malow-london.myshopify.com.');
    process.exit(1);
  }

  if (!ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET)) {
    console.error(
      'Set SHOPIFY_ADMIN_TOKEN (legacy) or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard → Settings).'
    );
    process.exit(1);
  }

  const { PRODUCTS, PRODUCTS_LIST } = loadProducts();
  const paths = collectImagePaths(PRODUCTS, PRODUCTS_LIST);

  /** @type {Map<string, string>} */
  const byBase = new Map();
  /** Fallback map: canonical name (trailing UUID stripped) → duplicate URL */
  const byCanonical = new Map();
  const dup = [];

  let cursor = null;
  let hasNext = true;
  let pages = 0;
  while (hasNext) {
    pages += 1;
    const data = await graphql({ cursor });
    const conn = data?.files;
    const nodes = conn?.nodes || [];
    for (const url of collectUrlsFromNodes(nodes)) {
      const base = basenameFromFileUrl(url);
      if (!base) continue;
      const key = base.toLowerCase();
      if (byBase.has(key) && byBase.get(key) !== url) {
        dup.push({ base, a: byBase.get(key), b: url });
      }
      if (!byBase.has(key)) byBase.set(key, url);
      // Also index under canonical name so duplicate uploads are found as fallback
      const canonical = stripTrailingUuid(base);
      if (canonical) {
        const ck = canonical.toLowerCase();
        if (!byCanonical.has(ck)) byCanonical.set(ck, url);
      }
    }
    hasNext = Boolean(conn?.pageInfo?.hasNextPage);
    cursor = conn?.pageInfo?.endCursor || null;
    if (!hasNext) break;
    if (pages > 500) {
      console.error('Stopped after 500 pages (sanity limit).');
      process.exit(1);
    }
  }

  const out = {};
  const missing = [];
  for (const rel of paths) {
    const expected = localPathToShopifyFilename(rel);
    const key = expected.toLowerCase();
    // Prefer duplicate (renamed) upload over original if original key also exists —
    // the duplicate was uploaded second and its CDN URL is the live one.
    const canonicalUrl = byCanonical.get(key);
    const exactUrl = byBase.get(key);
    const url = canonicalUrl || exactUrl;
    if (url) out[rel] = url;
    else missing.push({ rel, expected });
  }

  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  console.error(`Shopify Files pages fetched: ${pages}, unique basenames: ${byBase.size}`);
  console.error(`Catalogue paths: ${paths.length}, matched: ${Object.keys(out).length}, missing: ${missing.length}`);
  if (dup.length) {
    console.error(`Warning: ${dup.length} duplicate basename(s) in Files (first URL kept).`);
  }
  if (missing.length) {
    console.error('First unmatched (fix upload names or data/shopify-image-overrides.json):');
    for (const m of missing.slice(0, 15)) {
      console.error(`  ${m.rel} → expected Files name: ${m.expected}`);
    }
    if (missing.length > 15) console.error(`  … and ${missing.length - 15} more`);
  }
  console.error(`Wrote ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
