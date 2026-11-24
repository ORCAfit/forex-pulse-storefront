'use strict';
/**
 * Owner access: a passcode from the OWNER_PASSCODE env var (never hardcoded,
 * never the private app's passkey). A successful login sets a signed,
 * httpOnly cookie valid for 12 hours. No session store is needed.
 */
const crypto = require('crypto');

function secret() {
  return process.env.SESSION_SECRET || process.env.OWNER_PASSCODE || 'change-me-in-production';
}

function sign(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('hex');
}

function makeOwnerCookie() {
  const payload = Buffer.from(JSON.stringify({ owner: true, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function ownerLoggedIn(req) {
  const cookie = req.cookies && req.cookies.fp_owner;
  if (!cookie) return false;
  const [payload, sig] = cookie.split('.');
  if (!payload || !sig) return false;
  try {
    const expected = sign(payload);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.owner === true && data.exp > Date.now();
  } catch (_) {
    return false;
  }
}

function passcodeOk(candidate) {
  const expected = process.env.OWNER_PASSCODE || '';
  if (!expected || !candidate) return false;
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireOwner(req, res, next) {
  if (ownerLoggedIn(req)) return next();
  return res.redirect('/owner/login');
}

module.exports = { makeOwnerCookie, ownerLoggedIn, passcodeOk, requireOwner };
