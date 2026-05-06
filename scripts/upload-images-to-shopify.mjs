#!/usr/bin/env node
/**
 * Upload all product JPGs from exports/product-images-jpg/ to Shopify Content > Files.
 *
 * Uses the Shopify staged uploads flow:
 *   1. stagedUploadsCreate  → get signed S3 upload URL per file
 *   2. PUT file to signed URL
 *   3. fileCreate           → register file in Shopify
 *
 * Auth: reads SHOPIFY_SHOP + SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN) from .env
 *
 * Usage:
 *   node scripts/upload-images-to-shopify.mjs
 *   node scripts/upload-images-to-shopify.mjs --batch-size 5   (default: 5 concurrent uploads)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URLSearchParams } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

loadEnvFromFile(path.join(ROOT, '.env'));

const SHOP_RAW = process.env.SHOPIFY_SHOP || '';
const ADMIN_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN || '';
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID || '';
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET || '';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';

const IMAGES_DIR = path.join(ROOT, 'exports', 'product-images-jpg');

const argBatch = process.argv.find(a => a.startsWith('--batch-size='));
const BATCH_SIZE = argBatch ? parseInt(argBatch.split('=')[1], 10) : 5;

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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

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
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;
  const res = await fetch(`https://${SHOP_HOST}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Token request failed HTTP ${res.status}: ${JSON.stringify(body)}`);
  const { access_token, expires_in } = body;
  if (!access_token) throw new Error(`No access_token in response: ${JSON.stringify(body)}`);
  cachedToken = access_token;
  cachedTokenExpiresAt = Date.now() + Number(expires_in || 86400) * 1000;
  return cachedToken;
}

async function graphql(query, variables = {}) {
  const token = await getAccessToken();
  const endpoint = `https://${SHOP_HOST}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  if (body.errors?.length) throw new Error(body.errors.map(e => e.message).join('; '));
  return body.data;
}

const STAGED_UPLOADS_CREATE = `
mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets {
      url
      resourceUrl
      parameters { name value }
    }
    userErrors { field message }
  }
}`;

const FILE_CREATE = `
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      ... on MediaImage { id }
      ... on GenericFile { id url }
    }
    userErrors { field message }
  }
}`;

async function getStagedUploadTargets(files) {
  const input = files.map(f => ({
    filename: f.name,
    mimeType: 'image/jpeg',
    resource: 'FILE',
    fileSize: String(f.size),
    httpMethod: 'POST',
  }));
  const data = await graphql(STAGED_UPLOADS_CREATE, { input });
  const errors = data?.stagedUploadsCreate?.userErrors || [];
  if (errors.length) throw new Error(errors.map(e => e.message).join('; '));
  return data?.stagedUploadsCreate?.stagedTargets || [];
}

async function uploadFileToStaged(filePath, target) {
  const fileBuffer = fs.readFileSync(filePath);
  const formData = new FormData();
  for (const { name, value } of target.parameters) {
    formData.append(name, value);
  }
  formData.append('file', new Blob([fileBuffer], { type: 'image/jpeg' }));
  const res = await fetch(target.url, { method: 'POST', body: formData });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload to staged URL failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function registerFiles(resourceUrls) {
  const files = resourceUrls.map(url => ({
    originalSource: url,
    contentType: 'IMAGE',
  }));
  const data = await graphql(FILE_CREATE, { files });
  const errors = data?.fileCreate?.userErrors || [];
  if (errors.length) {
    console.error('  fileCreate warnings:', errors.map(e => e.message).join('; '));
  }
  return data?.fileCreate?.files || [];
}

async function processBatch(batch, doneCount, total) {
  const targets = await getStagedUploadTargets(batch.map(f => ({
    name: path.basename(f),
    size: fs.statSync(f).size,
  })));

  await Promise.all(batch.map((filePath, i) => uploadFileToStaged(filePath, targets[i])));

  const resourceUrls = targets.map(t => t.resourceUrl);
  await registerFiles(resourceUrls);

  console.log(`  Uploaded ${doneCount + batch.length}/${total} files`);
}

async function main() {
  if (!SHOP_SUB) { console.error('Set SHOPIFY_SHOP in .env'); process.exit(1); }
  if (!ADMIN_TOKEN && (!CLIENT_ID || !CLIENT_SECRET)) {
    console.error('Set SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET in .env');
    process.exit(1);
  }

  const files = fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(jpg|jpeg)$/i.test(f))
    .map(f => path.join(IMAGES_DIR, f));

  console.log(`Found ${files.length} images to upload in batches of ${BATCH_SIZE}...`);

  let done = 0;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    try {
      await processBatch(batch, done, files.length);
      done += batch.length;
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${err.message}`);
      console.error('  Retrying one by one...');
      for (const filePath of batch) {
        try {
          await processBatch([filePath], done, files.length);
          done++;
        } catch (e2) {
          console.error(`  FAILED: ${path.basename(filePath)} — ${e2.message}`);
        }
      }
    }
    // Small delay between batches to avoid rate limits
    if (i + BATCH_SIZE < files.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\nDone! ${done}/${files.length} images uploaded.`);
  console.log('Now run: node scripts/fetch-shopify-file-urls-from-admin.mjs');
  console.log('Then run: node scripts/export-shopify-products-csv.mjs --all-variant-images');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
