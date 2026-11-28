'use strict';
/**
 * Buyer confirmation email (nodemailer over SMTP).
 * SMTP is configured only through env vars. If no SMTP is configured the
 * caller must NOT fail the payment flow — it returns { sent: false,
 * reason: 'not_configured' } so the Orders page can show the manual-send
 * notice with the buyer's email and the unlocked signal details.
 */
const nodemailer = require('nodemailer');

function transporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

function signalEmailHtml({ buyerName, signal, unlockUrl }) {
  const dir = signal.direction === 'BUY' ? 'BUY signal' : 'SELL signal';
  const posted = new Date(signal.created_at).toLocaleString('en-US', { timeZone: 'America/New_York' });
  return `
    <div style="font-family:Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="color:#b8860b">Forex Pulse — your signal is unlocked</h2>
      <p>Hi ${buyerName},</p>
      <p>Your $20 payment was received. Your signal is now unlocked:</p>
      <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">
        <tr><td><b>Pair</b></td><td>${signal.pair}</td></tr>
        <tr><td><b>Direction</b></td><td>${dir}</td></tr>
        <tr><td><b>Entry price</b></td><td>${signal.entry}</td></tr>
        <tr><td><b>Take profit</b></td><td>${signal.take_profit}</td></tr>
        <tr><td><b>Stop loss</b></td><td>${signal.stop_loss}</td></tr>
        <tr><td><b>Posted</b></td><td>${posted} (New York)</td></tr>
      </table>
      <p>You can view it any time here: <a href="${unlockUrl}">${unlockUrl}</a></p>
      <p style="color:#666;font-size:13px">Trading involves risk. Signals are not guaranteed. This is not financial advice.</p>
      <p>— Forex Pulse</p>
    </div>`;
}

async function sendUnlockEmail({ buyerName, buyerEmail, signal, unlockUrl }) {
  const t = transporter();
  if (!t) return { sent: false, reason: 'not_configured' };
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: buyerEmail,
      subject: `Forex Pulse — your ${signal.pair} ${signal.direction} signal is unlocked`,
      html: signalEmailHtml({ buyerName, signal, unlockUrl }),
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: 'send_failed', error: e.message };
  }
}

// Buyer email for a paid indicator order: a durable download link for the
// compiled .ex4 file(s). Same SMTP / not-configured behaviour as signals.
function indicatorEmailHtml({ buyerName, productName, amountLabel, downloadUrl, files }) {
  const rows = files.map((f) => `<li>${f}</li>`).join('');
  return `
    <div style="font-family:Arial,sans-serif;color:#111;max-width:560px">
      <h2 style="color:#b8860b">Forex Pulse — your indicator download</h2>
      <p>Hi ${buyerName},</p>
      <p>Your ${amountLabel} payment was received. Here is your download:</p>
      <p><b>${productName}</b></p>
      <ul>${rows}</ul>
      <p>Download it any time here: <a href="${downloadUrl}">${downloadUrl}</a></p>
      <p>Install it in MetaTrader 4: copy the .ex4 file into your MT4 <b>MQL4/Indicators</b> folder, then restart MT4 or refresh the Navigator.</p>
      <p style="color:#666;font-size:13px">Copyright (C) 2026 DEUS. All rights reserved. Licensed for your own use only — you may run the indicator on your own charts, but may NOT copy, share, repost, resell or redistribute it, in whole or in part, without DEUS's written permission. One-time purchase, no expiration date. Analytical tools only — they never place trades and are not financial advice.</p>
      <p>— Forex Pulse</p>
    </div>`;
}

async function sendIndicatorEmail({ buyerName, buyerEmail, productName, amountLabel, downloadUrl, files }) {
  const t = transporter();
  if (!t) return { sent: false, reason: 'not_configured' };
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: buyerEmail,
      subject: `Forex Pulse — your ${productName} download`,
      html: indicatorEmailHtml({ buyerName, productName, amountLabel, downloadUrl, files }),
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: 'send_failed', error: e.message };
  }
}

module.exports = { sendUnlockEmail, sendIndicatorEmail, smtpConfigured: () => !!transporter() };
