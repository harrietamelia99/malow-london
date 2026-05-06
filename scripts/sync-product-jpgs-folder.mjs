#!/usr/bin/env node
/**
 * Fill exports/product-images-jpg/ with one JPG per catalogue image from js/products.js.
 *
 * 1) If the PNG exists under the repo (e.g. images/…), converts with macOS `sips`.
 * 2) Otherwise tries the CDN URL from data/shopify-product-image-urls.json (must match Files).
 *
 * Output filenames follow Shopify-style stems (see scripts/build-shopify-image-urls.mjs).
 *
 * Usage:
 *   node scripts/sync-product-jpgs-folder.mjs
 *   node scripts/sync-product-jpgs-folder.mjs --force   # overwrite existing JPGs
 */

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MAP_PATH = path.join(ROOT, 'data', 'shopify-product-image-urls.json');
const OUT_DIR = path.join(ROOT, 'exports', 'product-images-jpg');
const FETCH_CONCURRENCY = 6;

const FORCE = process.argv.includes('--force');

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

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (true) {
      const i = index++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function convertWithSips(srcPng, destJpg) {
  fs.mkdirSync(path.dirname(destJpg), { recursive: true });
  const r = spawnSync('/usr/bin/sips', ['-s', 'format', 'jpeg', srcPng, '--out', destJpg], {
    encoding: 'utf8',
  });
  return r.status === 0;
}

async function main() {
  if (!fs.existsSync(MAP_PATH)) {
    console.error(`Missing ${MAP_PATH}. Run: node scripts/build-shopify-image-urls.mjs`);
    process.exit(1);
  }
  const urlMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  const { PRODUCTS, PRODUCTS_LIST } = loadProducts();
  const paths = collectImagePaths(PRODUCTS, PRODUCTS_LIST);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let fromLocal = 0;
  let fromUrl = 0;
  let skipped = 0;
  const fetchJobs = [];

  for (const rel of paths) {
    const outName = localPathToShopifyFilename(rel);
    const dest = path.join(OUT_DIR, outName);
    const localSrc = path.join(ROOT, rel);

    if (!FORCE && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      skipped += 1;
      continue;
    }

    let needFetch = false;
    if (fs.existsSync(localSrc) && /\.png$/i.test(localSrc)) {
      if (convertWithSips(localSrc, dest)) {
        fromLocal += 1;
        continue;
      }
      needFetch = true;
    } else {
      needFetch = true;
    }

    const url = urlMap[rel];
    if (needFetch && typeof url === 'string' && /^https?:\/\//i.test(url)) {
      fetchJobs.push({ rel, dest, url });
    } else if (needFetch) {
      fetchJobs.push({ rel, dest, url: null });
    }
  }

  const failures = [];

  await mapPool(
    fetchJobs.filter((j) => j.url),
    FETCH_CONCURRENCY,
    async (job) => {
      try {
        const res = await fetch(job.url, { redirect: 'follow' });
        if (!res.ok) {
          failures.push({ rel: job.rel, reason: `HTTP ${res.status}`, url: job.url });
          return;
        }
        fs.writeFileSync(job.dest, Buffer.from(await res.arrayBuffer()));
        fromUrl += 1;
      } catch (e) {
        failures.push({ rel: job.rel, reason: e.message || String(e), url: job.url });
      }
    }
  );

  for (const job of fetchJobs) {
    if (job.url) continue;
    failures.push({
      rel: job.rel,
      reason: 'no usable local PNG and no CDN URL (add file or fix data/shopify-product-image-urls.json)',
    });
  }

  console.error(`Folder: ${OUT_DIR}`);
  console.error(`  From local PNG (sips): ${fromLocal}`);
  console.error(`  From CDN fetch: ${fromUrl}`);
  console.error(`  Skipped (already had JPG): ${skipped}`);
  console.error(`  Missing / failed: ${failures.length}`);

  if (failures.length) {
    for (const f of failures.slice(0, 25)) {
      console.error(`  - ${f.rel}: ${f.reason}${f.url ? ` (${f.url})` : ''}`);
    }
    if (failures.length > 25) console.error(`  … and ${failures.length - 25} more`);
    console.error('');
    console.error(
      'Put missing PNGs under images/… matching paths in js/products.js, or paste real CDN URLs into shopify-image-urls.json (see export script README flow), then re-run.'
    );
    process.exit(1);
  }
}

main();
