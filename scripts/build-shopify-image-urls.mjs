#!/usr/bin/env node
/**
 * Build data/shopify-product-image-urls.json — maps each images/… path from js/products.js
 * to a Shopify Files CDN URL using config/shopify-cdn.json + filename rules.
 *
 * Rules (Shopify Files usually keep the same stem as your upload; we only normalise extension):
 *   - .png → .jpg
 *   - _PU_copy → _copy
 *
 * We no longer strip _PU before ABOVE|SIDE|… — some ranges (e.g. Sabrina) keep _PU on Shopify;
 * stripping produced wrong URLs and “Media processing failed”. Fix one-offs in
 * data/shopify-image-overrides.json (paste Files → Copy link).
 *
 * Also writes exports/malow-shopify-product-files-only.csv — one row per catalogue image
 * (local_path, cdn_url), excluding anything not referenced from js/products.js (e.g. about page assets).
 *
 * Usage: node scripts/build-shopify-image-urls.mjs
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function loadProducts() {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'products.js'), 'utf8');
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\nvar __EXPORT = PRODUCTS;\nvar __LIST = PRODUCTS_LIST;`, ctx);
  return { PRODUCTS: ctx.__EXPORT, PRODUCTS_LIST: ctx.__LIST };
}

function loadJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return { ...fallback };
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/** Match Shopify-style filenames after upload (see file header for rules). */
function localPathToShopifyFilename(localPath) {
  let name = path.basename(localPath);
  name = name.replace(/\.png$/i, '.jpg');
  name = name.replace(/_PU_copy/gi, '_copy');
  return name;
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

/** Paths referenced from products only; skips obvious site/theme assets if ever linked by mistake. */
function isCatalogueProductImagePath(norm) {
  const base = path.basename(norm);
  if (/^about-/i.test(base)) return false;
  if (/\.svg$/i.test(base)) return false;
  return true;
}

function csvEscape(val) {
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const configPath = path.join(ROOT, 'config', 'shopify-cdn.json');
  const overridesPath = path.join(ROOT, 'data', 'shopify-image-overrides.json');
  const outPath = path.join(ROOT, 'data', 'shopify-product-image-urls.json');
  const productFilesCsvPath = path.join(ROOT, 'exports', 'malow-shopify-product-files-only.csv');

  const { cdnBase } = loadJson(configPath);
  if (!cdnBase || typeof cdnBase !== 'string') {
    console.error('Missing config/shopify-cdn.json with "cdnBase".');
    process.exit(1);
  }
  const base = cdnBase.replace(/\/$/, '');

  const { PRODUCTS, PRODUCTS_LIST } = loadProducts();
  const paths = collectImagePaths(PRODUCTS, PRODUCTS_LIST);
  const overrides = loadJson(overridesPath);

  const map = {};
  for (const rel of paths) {
    const fn = localPathToShopifyFilename(rel);
    map[rel] = `${base}/${fn}`;
  }
  Object.assign(map, overrides);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');

  fs.mkdirSync(path.dirname(productFilesCsvPath), { recursive: true });
  const csvLines = [['local_path', 'cdn_url'].join(',')];
  for (const rel of paths) {
    const url = map[rel];
    if (!url) continue;
    csvLines.push([csvEscape(rel), csvEscape(url)].join(','));
  }
  fs.writeFileSync(productFilesCsvPath, `${csvLines.join('\n')}\n`, 'utf8');

  console.error(`Wrote ${outPath} (${paths.length} paths, ${Object.keys(overrides).length} overrides).`);
  console.error(`Wrote ${productFilesCsvPath} (${paths.length} product files, no site assets).`);
}

main();
