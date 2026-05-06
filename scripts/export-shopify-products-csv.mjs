#!/usr/bin/env node
/**
 * Build shopify-products-import.csv from js/products.js using Shopify's CSV columns.
 *
 * Headers: shopify-product-template.csv (first row), or SHOPIFY_PRODUCT_TEMPLATE=…
 *
 * Images: built into data/shopify-product-image-urls.json via scripts/build-shopify-image-urls.mjs
 * (runs automatically unless you pass --skip-image-build). CDN base: config/shopify-cdn.json
 * Fix odd filenames in data/shopify-image-overrides.json (paste “Copy link” from Shopify Files).
 * Optional: shopify-image-urls.json at repo root for extra overrides (gitignored).
 * Bulk URLs: scripts/fetch-shopify-file-urls-from-admin.mjs + Admin API **read_files**
 *   (SHOPIFY_ADMIN_TOKEN legacy, or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET from Dev Dashboard).
 *
 * Variant images: default = **first UK size only** per colour (Shopify often throws
 * “Media processing failed” if the same Files URL is attached to every size row).
 * To try all sizes (Admin thumbs on every SKU): `MALOW_VARIANT_IMAGE_ALL_SIZES=true` or
 * `node scripts/export-shopify-products-csv.mjs --all-variant-images` (may break import).
 *
 * Usage:
 *   node scripts/export-shopify-products-csv.mjs
 *   node scripts/export-shopify-products-csv.mjs --skip-image-build --quiet
 *   node scripts/export-shopify-products-csv.mjs --dump-image-keys
 *
 * Outputs:
 *   shopify-products-import.csv              — full Shopify import (products + variants + images)
 *   exports/malow-products.csv                 — same template, image columns empty (products-only path)
 *   exports/malow-product-images.csv         — 4 columns: handle, image_url, position, alt_text
 *   exports/malow-shopify-product-files-only.csv — catalogue-only (local_path, cdn_url); no site assets (from build script)
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const TEMPLATE_PATH =
  process.env.SHOPIFY_PRODUCT_TEMPLATE ||
  path.join(ROOT, 'shopify-product-template.csv');

const IMAGE_BASE = (process.env.MALOW_IMAGE_BASE || '').replace(/\/$/, '');
const QUIET = process.argv.includes('--quiet');
const VERBOSE = process.argv.includes('--verbose');
const ALL_VARIANT_IMAGES =
  ['1', 'true', 'yes'].includes(String(process.env.MALOW_VARIANT_IMAGE_ALL_SIZES || '').toLowerCase()) ||
  process.argv.includes('--all-variant-images');

function log(...args) {
  if (!QUIET) console.error(...args);
}

/** Minimal RFC4180-style line parse (handles quoted fields). */
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      q = !q;
      continue;
    }
    if (!q && c === ',') {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

function loadHeaders() {
  const raw = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  const firstLine = raw.split(/\r?\n/)[0];
  const headers = parseCsvLine(firstLine);
  if (headers.length < 10) {
    throw new Error(`Bad template header row in ${TEMPLATE_PATH}`);
  }
  return headers;
}

function loadProducts() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'products.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\nvar __EXPORT = PRODUCTS;\nvar __LIST = PRODUCTS_LIST;`, ctx);
  return { PRODUCTS: ctx.__EXPORT, PRODUCTS_LIST: ctx.__LIST };
}

function loadImageMaps() {
  const dataPath = path.join(ROOT, 'data', 'shopify-product-image-urls.json');
  const rootPath = path.join(ROOT, 'shopify-image-urls.json');
  let data = {};
  let root = {};
  try {
    if (fs.existsSync(dataPath)) data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch {
    log(`Could not read ${dataPath}`);
  }
  try {
    if (fs.existsSync(rootPath)) root = JSON.parse(fs.readFileSync(rootPath, 'utf8'));
  } catch {
    log(`Could not read ${rootPath}`);
  }
  return { ...data, ...root };
}

function resolveImageUrl(relPath, map) {
  const norm = relPath.replace(/^\//, '');
  if (map[norm]) return map[norm];
  const baseName = path.basename(norm);
  for (const [k, v] of Object.entries(map)) {
    if (path.basename(k) === baseName) return v;
  }
  if (IMAGE_BASE) {
    return `${IMAGE_BASE}/${path.basename(norm)}`;
  }
  return '';
}

function csvEscape(val) {
  if (val == null || val === '') return '';
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowFromHeaders(headers, obj) {
  const cells = headers.map((h) => obj[h] ?? '');
  return cells.map(csvEscape).join(',');
}

function blankRow(headers) {
  const o = {};
  for (const h of headers) o[h] = '';
  return o;
}

function stripImageColumns(o) {
  const x = { ...o };
  x['Product image URL'] = '';
  x['Image position'] = '';
  x['Image alt text'] = '';
  x['Variant image URL'] = '';
  return x;
}

function bodyHtml(product) {
  const esc = (t) =>
    String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const bullets = (product.details || []).map((d) => `<li>${esc(d)}</li>`).join('');
  return `<p>${esc(product.description)}</p><ul>${bullets}</ul>`;
}

function tagsFor(product) {
  const parts = [...(product.categories || []).map((c) => String(c).trim())];
  if (product.bestseller) parts.push('Bestseller');
  return parts.filter(Boolean).join(', ');
}

/** Shopify template-style option value for color metafield (lowercase words). */
function colorOptionValue(label) {
  return String(label).trim().toLowerCase();
}

/** Gallery URLs in stable order: each colour’s images in variant order, deduped. */
function orderedGalleryImages(product, map) {
  const out = [];
  const seen = new Set();
  for (const col of product.variants || []) {
    for (const rel of col.images || []) {
      const url = resolveImageUrl(rel, map);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, alt: col.label });
    }
  }
  return out;
}

function colorMetafieldList(product) {
  return (product.variants || []).map((v) => colorOptionValue(v.label)).join('; ');
}

function dumpImageKeys(PRODUCTS, PRODUCTS_LIST) {
  const keys = new Set();
  for (const id of PRODUCTS_LIST) {
    const p = PRODUCTS[id];
    if (!p) continue;
    for (const col of p.variants || []) {
      for (const rel of col.images || []) {
        keys.add(rel.replace(/^\//, ''));
      }
    }
  }
  const sorted = [...keys].sort();
  const obj = Object.fromEntries(sorted.map((k) => [k, '']));
  const out = path.join(ROOT, 'shopify-image-urls.template.json');
  fs.writeFileSync(out, `${JSON.stringify(obj, null, 2)}\n`, 'utf8');
  log(`Wrote ${out} (${sorted.length} keys). Paste each file’s CDN URL, save as shopify-image-urls.json, then re-run export.`);
}

function main() {
  const { PRODUCTS, PRODUCTS_LIST } = loadProducts();

  if (process.argv.includes('--dump-image-keys')) {
    dumpImageKeys(PRODUCTS, PRODUCTS_LIST);
    return;
  }

  if (!process.argv.includes('--skip-image-build')) {
    const buildScript = path.join(__dirname, 'build-shopify-image-urls.mjs');
    const res = spawnSync(process.execPath, [buildScript], {
      cwd: ROOT,
      stdio: QUIET ? 'pipe' : 'inherit',
    });
    if (res.status !== 0) {
      console.error('build-shopify-image-urls.mjs failed; fix config/data JSON or run with --skip-image-build');
      process.exit(res.status ?? 1);
    }
  }

  const headers = loadHeaders();
  const imageMap = loadImageMaps();

  const lines = [headers.map(csvEscape).join(',')];
  /** Flat list of variant row objects (for products-only CSV). */
  const variantRowObjects = [];
  /** Simple image manifest: one row per unique product image in gallery order. */
  const imageManifestRows = [];

  let variantRows = 0;
  let imageRows = 0;

  const H = {
    vendor: 'MALOW London',
    productCategory: 'Apparel & Accessories > Shoes',
    type: "Women's footwear",
    published: 'TRUE',
    status: 'Active',
    option1Name: 'UK size',
    option2Name: 'Color',
    option2Linked: 'product.metafields.shopify.color-pattern',
    price: (p) => Number(p.price).toFixed(2),
    chargeTax: 'TRUE',
    inventoryTracker: 'shopify',
    inventoryQty: '0',
    continueSelling: 'DENY',
    weightG: '650',
    weightUnit: 'g',
    requiresShipping: 'TRUE',
    fulfillment: 'manual',
    giftCard: 'FALSE',
    googleCategory: 'Apparel & Accessories > Shoes',
    googleGender: 'Female',
    googleAge: 'Adult (13+ years old)',
  };

  for (const id of PRODUCTS_LIST) {
    const p = PRODUCTS[id];
    if (!p) continue;

    const handle = p.id;
    const description = bodyHtml(p);
    const tags = tagsFor(p);
    const gallery = orderedGalleryImages(p, imageMap);
    const primary = gallery[0];

    const sizes = p.sizes || [];
    const colours = p.variants || [];

    const variantHeroUrls = new Set(
      colours.map((c) => (c.images?.[0] ? resolveImageUrl(c.images[0], imageMap) : '')).filter(Boolean)
    );

    gallery.forEach((item, idx) => {
      if (!item.url) return;
      imageManifestRows.push({
        handle,
        image_url: item.url,
        position: String(idx + 1),
        alt_text: `${p.name} — ${item.alt}`,
      });
    });

    let rowIndex = 0;
    for (const size of sizes) {
      for (const colour of colours) {
        const o = blankRow(headers);
        o['URL handle'] = handle;
        o.SKU = `${handle}-${colour.id}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, '-');
        o['Option1 value'] = String(size);
        o['Option2 value'] = colorOptionValue(colour.label);
        o.Price = H.price(p);
        o['Compare-at price'] = '';
        o['Cost per item'] = '';
        o['Charge tax'] = H.chargeTax;
        o['Tax code'] = '';
        o['Unit price total measure'] = '';
        o['Unit price total measure unit'] = '';
        o['Unit price base measure'] = '';
        o['Unit price base measure unit'] = '';
        o['Inventory tracker'] = H.inventoryTracker;
        o['Inventory quantity'] = H.inventoryQty;
        o['Continue selling when out of stock'] = H.continueSelling;
        o['Weight value (grams)'] = H.weightG;
        o['Weight unit for display'] = H.weightUnit;
        o['Requires shipping'] = H.requiresShipping;
        o['Fulfillment service'] = H.fulfillment;
        o['Gift card'] = H.giftCard;
        const variantHero = colour.images?.[0] ? resolveImageUrl(colour.images[0], imageMap) : '';
        /* Default: hero URL on first size only — repeating the same CDN URL on every size row
           often triggers Shopify “Media processing failed” on CSV import. */
        const firstSize = sizes.length ? sizes[0] : null;
        o['Variant image URL'] =
          !variantHero ? ''
          : ALL_VARIANT_IMAGES || size === firstSize ? variantHero
          : '';

        if (rowIndex === 0) {
          o.Title = p.name;
          o.Description = description;
          o.Vendor = H.vendor;
          o['Product category'] = H.productCategory;
          o.Type = H.type;
          o.Tags = tags;
          o['Published on online store'] = H.published;
          o.Status = H.status;
          o.Barcode = '';
          o['Option1 name'] = H.option1Name;
          o['Option1 Linked To'] = '';
          o['Option2 name'] = H.option2Name;
          o['Option2 Linked To'] = H.option2Linked;
          o['Option3 name'] = '';
          o['Option3 value'] = '';
          o['Option3 Linked To'] = '';

          if (primary?.url) {
            o['Product image URL'] = primary.url;
            o['Image position'] = '1';
            o['Image alt text'] = colorOptionValue(primary.alt);
          }

          o['SEO title'] = `${p.name} | MALOW London`;
          o['SEO description'] = p.tagline || '';
          o['Color (product.metafields.shopify.color-pattern)'] = colorMetafieldList(p);
          o['Google Shopping / Google product category'] = H.googleCategory;
          o['Google Shopping / Gender'] = H.googleGender;
          o['Google Shopping / Age group'] = H.googleAge;
        } else {
          o['Option1 name'] = '';
          o['Option1 Linked To'] = '';
          o['Option2 name'] = '';
          o['Option2 Linked To'] = '';
        }

        variantRowObjects.push({ ...o });
        lines.push(rowFromHeaders(headers, o));
        variantRows += 1;
        rowIndex += 1;
      }
    }

    const galleryExtras = gallery
      .slice(1)
      .filter((item) => item.url && !variantHeroUrls.has(item.url));
    galleryExtras.forEach((item, idx) => {
      const o = blankRow(headers);
      o['URL handle'] = handle;
      o['Product image URL'] = item.url;
      o['Image position'] = String(idx + 2);
      o['Image alt text'] = colorOptionValue(item.alt);
      lines.push(rowFromHeaders(headers, o));
      imageRows += 1;
    });
  }

  const exportsDir = path.join(ROOT, 'exports');
  fs.mkdirSync(exportsDir, { recursive: true });

  const outPath = path.join(ROOT, 'shopify-products-import.csv');
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');

  const productsOnlyPath = path.join(exportsDir, 'malow-products.csv');
  const productsOnlyLines = [
    headers.map(csvEscape).join(','),
    ...variantRowObjects.map((obj) => rowFromHeaders(headers, stripImageColumns(obj))),
  ];
  fs.writeFileSync(productsOnlyPath, `${productsOnlyLines.join('\n')}\n`, 'utf8');

  const IMG_COLS = ['handle', 'image_url', 'position', 'alt_text'];
  const imagesPath = path.join(exportsDir, 'malow-product-images.csv');
  const imagesLines = [
    IMG_COLS.join(','),
    ...imageManifestRows.map((r) =>
      [r.handle, r.image_url, r.position, r.alt_text].map(csvEscape).join(',')
    ),
  ];
  fs.writeFileSync(imagesPath, `${imagesLines.join('\n')}\n`, 'utf8');

  log(`Wrote ${outPath}`);
  log(`Wrote ${productsOnlyPath} (products + variants, no images)`);
  log(`Wrote ${imagesPath} (${imageManifestRows.length} images, 4 columns)`);
  log(
    ALL_VARIANT_IMAGES
      ? `  Variant image URL: all sizes (may cause Shopify media errors).`
      : `  Variant image URL: first size per colour only (stable import).`
  );
  log(`  Combined: ${variantRows} variant rows, ${imageRows} extra image rows, ${headers.length} columns.`);

  const hasImages = Object.keys(imageMap).length > 0;
  if (!hasImages && !IMAGE_BASE) {
    log(
      '  Images: no data/shopify-product-image-urls.json entries — run config + scripts/build-shopify-image-urls.mjs'
    );
  } else if (VERBOSE) {
    log(`  Images: ${Object.keys(imageMap).length} paths in map.`);
  }
}

main();
