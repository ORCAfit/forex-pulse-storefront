'use strict';
/**
 * MT4 indicator products sold on the storefront.
 * One-time purchase, no expiration, no sales tax — same terms as the
 * $20 signals.
 *
 * ONLY compiled .ex4 files are ever sold or served. The .mq4 source is
 * never placed in downloads/ and no route serves it.
 *
 * The .ex4 files do not exist yet — Demetrius compiles them in MetaEditor
 * (F7) from the _V .mq4 files on his laptop and drops them in downloads/
 * (see downloads/README.md). A product can only be bought when its .ex4
 * file is present: the buy button stays disabled ("Coming soon") until
 * then, and the checkout API refuses to start a session, so nobody can
 * pay for a file that cannot be delivered.
 */
const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.join(__dirname, '..', 'downloads');

const PRODUCTS = {
  flr: {
    id: 'flr',
    name: 'Forex Level Radar Pro',
    code: 'FLR-MT4-001',
    priceCents: 14900,
    priceLabel: '$149',
    file: 'Forex_Level_Radar_Pro_V.ex4',
  },
  fbpi: {
    id: 'fbpi',
    name: 'Forex Bigger Picture Intelligence System',
    code: 'FBPI-MT4-001',
    priceCents: 19900,
    priceLabel: '$199',
    file: 'FBPI_Main_SingleFile_V.ex4',
  },
  bundle: {
    id: 'bundle',
    name: 'Bundle — Both Indicators',
    code: 'FLR-MT4-001 + FBPI-MT4-001',
    priceCents: 29900,
    priceLabel: '$299',
    saveLabel: 'Save $49',
    // A bundle delivers both single-indicator files.
    files: ['Forex_Level_Radar_Pro_V.ex4', 'FBPI_Main_SingleFile_V.ex4'],
  },
};

// The single-indicator products, in display order.
const SINGLE_PRODUCTS = ['flr', 'fbpi'];

// Every file a purchase of this product delivers: [{ productId, filename }]
function productDownloads(product) {
  if (product.id === 'bundle') {
    return [
      { productId: 'flr', filename: PRODUCTS.flr.file },
      { productId: 'fbpi', filename: PRODUCTS.fbpi.file },
    ];
  }
  return [{ productId: product.id, filename: product.file }];
}

function filePresent(filename) {
  try {
    return fs.statSync(path.join(DOWNLOADS_DIR, filename)).isFile();
  } catch (_) { return false; }
}

// Buyable only when every file the purchase delivers exists on disk.
function isAvailable(product) {
  return productDownloads(product).every((d) => filePresent(d.filename));
}

function availability() {
  const out = {};
  for (const [id, p] of Object.entries(PRODUCTS)) out[id] = isAvailable(p);
  return out;
}

// Whitelisted download: a single-indicator product id -> absolute path of
// its .ex4 file, or null if the file is not present. Never serves a path
// supplied by a request — only these exact names, only from downloads/.
// Bundles download per indicator (see productDownloads), not as one file.
function downloadPath(productId) {
  const p = PRODUCTS[productId];
  if (!p || !p.file) return null;
  return filePresent(p.file) ? path.join(DOWNLOADS_DIR, p.file) : null;
}

module.exports = {
  PRODUCTS, SINGLE_PRODUCTS, DOWNLOADS_DIR,
  productFiles: productDownloads, productDownloads,
  filePresent, isAvailable, availability, downloadPath,
};
