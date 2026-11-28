'use strict';
/**
 * MT4 indicator products sold on the storefront.
 * One-time purchase, no expiration, no sales tax — same terms as the
 * $20 signals.
 *
 * Each product downloads as a ZIP PACKAGE, not a bare .ex4 file. The zip
 * holds the compiled .ex4 plus the documents, presets, sample data and
 * install guide the page's "Includes" line promises (see PACKAGING.md
 * for the exact layout and build commands).
 *
 * ONLY the compiled .ex4 is ever sold or served, inside its zip. The
 * .mq4 source is never placed in downloads/ and no route serves it —
 * the build script refuses to package any .mq4 file.
 *
 * The .ex4 files do not exist yet — Demetrius compiles them in MetaEditor
 * (F7) from the _V .mq4 files on his laptop; the zips are then built
 * from the .ex4 files and placed in downloads/ (see PACKAGING.md and
 * downloads/README.md). A product can only be bought when its ZIP is
 * present: the buy button stays disabled ("Coming soon") until then,
 * and the checkout API refuses to start a session, so nobody can pay
 * for a package that cannot be delivered.
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
    // The zip package this purchase downloads.
    file: 'Forex_Level_Radar_Pro.zip',
    // The compiled indicator inside the zip.
    ex4File: 'Forex_Level_Radar_Pro_V.ex4',
    // Human-readable package contents, shown on the download page and
    // in the buyer email.
    contents: [
      'Forex_Level_Radar_Pro_V.ex4 — the compiled indicator',
      '8 documents, including the Installation Guide and User Manual',
      '3 presets: Standard, Conservative, Aggressive (.set files)',
      'Sample_Scoreboard.csv + Sample_Scoreboard.README.md',
    ],
  },
  fbpi: {
    id: 'fbpi',
    name: 'Forex Bigger Picture Intelligence System',
    code: 'FBPI-MT4-001',
    priceCents: 19900,
    priceLabel: '$199',
    file: 'FBPI_Main_SingleFile.zip',
    ex4File: 'FBPI_Main_SingleFile_V.ex4',
    contents: [
      'FBPI_Main_SingleFile_V.ex4 — the compiled indicator (single-file build)',
      '11 documents, including the Installation Guide and User Manual',
      '3 presets: Standard, Conservative, Aggressive (.set files)',
      'Sample_Scoreboard.csv + Sample_Historical_Statistics.csv',
    ],
  },
  bundle: {
    id: 'bundle',
    name: 'Bundle — Both Indicators',
    code: 'FLR-MT4-001 + FBPI-MT4-001',
    priceCents: 29900,
    priceLabel: '$299',
    saveLabel: 'Save $49',
    // A bundle delivers both single-indicator zip packages.
    files: ['Forex_Level_Radar_Pro.zip', 'FBPI_Main_SingleFile.zip'],
  },
};

// The single-indicator products, in display order.
const SINGLE_PRODUCTS = ['flr', 'fbpi'];

// Every package a purchase of this product delivers: [{ productId, filename }]
function productDownloads(product) {
  if (product.id === 'bundle') {
    return [
      { productId: 'flr', filename: PRODUCTS.flr.file },
      { productId: 'fbpi', filename: PRODUCTS.fbpi.file },
    ];
  }
  return [{ productId: product.id, filename: product.file }];
}

// Every package a purchase delivers, with its contents listed for the
// download page and the buyer email: [{ productId, filename, items }]
function packageContents(product) {
  return productDownloads(product).map((d) => ({
    productId: d.productId,
    filename: d.filename,
    items: PRODUCTS[d.productId].contents,
  }));
}

function filePresent(filename) {
  try {
    return fs.statSync(path.join(DOWNLOADS_DIR, filename)).isFile();
  } catch (_) { return false; }
}

// Buyable only when every package the purchase delivers exists on disk.
function isAvailable(product) {
  return productDownloads(product).every((d) => filePresent(d.filename));
}

function availability() {
  const out = {};
  for (const [id, p] of Object.entries(PRODUCTS)) out[id] = isAvailable(p);
  return out;
}

// Whitelisted download: a single-indicator product id -> absolute path of
// its zip package, or null if the package is not present. Never serves a
// path supplied by a request — only these exact names, only from
// downloads/. Bundles download per indicator (see productDownloads),
// one zip per indicator, not a single combined file.
function downloadPath(productId) {
  const p = PRODUCTS[productId];
  if (!p || !p.file) return null;
  return filePresent(p.file) ? path.join(DOWNLOADS_DIR, p.file) : null;
}

module.exports = {
  PRODUCTS, SINGLE_PRODUCTS, DOWNLOADS_DIR,
  productFiles: productDownloads, productDownloads, packageContents,
  filePresent, isAvailable, availability, downloadPath,
};
