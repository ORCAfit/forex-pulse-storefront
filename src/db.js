'use strict';
/**
 * SQLite storage (Node 24 built-in node:sqlite — no extra dependency).
 * DATABASE_PATH env var points at the file; on Render this is on the
 * persistent disk (/var/data/forex-pulse.db). Locally it defaults to
 * ./data/forex-pulse.db so signals/orders survive restarts.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'forex-pulse.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pair TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('BUY','SELL')),
    entry REAL NOT NULL,
    take_profit REAL NOT NULL,
    stop_loss REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','closed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id INTEGER NOT NULL REFERENCES signals(id),
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    access_token TEXT NOT NULL UNIQUE,
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    amount_cents INTEGER NOT NULL DEFAULT 2000,
    currency TEXT NOT NULL DEFAULT 'usd',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed')),
    email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending','sent','failed','not_configured')),
    email_error TEXT,
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
  CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
  CREATE INDEX IF NOT EXISTS idx_orders_token ON orders(access_token);
  CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(stripe_session_id);
`);

const nowIso = () => new Date().toISOString();

function createSignal({ pair, direction, entry, takeProfit, stopLoss }) {
  const ts = nowIso();
  const r = db.prepare(
    'INSERT INTO signals (pair, direction, entry, take_profit, stop_loss, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(pair, direction, entry, takeProfit, stopLoss, 'open', ts, ts);
  return getSignal(r.lastInsertRowid);
}

function getSignal(id) {
  return db.prepare('SELECT * FROM signals WHERE id = ?').get(id) || null;
}

function listSignals(status) {
  if (status) {
    return db.prepare('SELECT * FROM signals WHERE status = ? ORDER BY created_at DESC').all(status);
  }
  return db.prepare('SELECT * FROM signals ORDER BY created_at DESC').all();
}

function setSignalStatus(id, status) {
  const ts = nowIso();
  db.prepare('UPDATE signals SET status = ?, updated_at = ?, closed_at = ? WHERE id = ?')
    .run(status, ts, status === 'open' ? null : ts, id);
  return getSignal(id);
}

function deleteSignal(id) {
  db.prepare('DELETE FROM signals WHERE id = ?').run(id);
}

function createOrder({ signalId, buyerName, buyerEmail, accessToken }) {
  const ts = nowIso();
  const r = db.prepare(
    'INSERT INTO orders (signal_id, buyer_name, buyer_email, access_token, status, email_status, created_at) VALUES (?,?,?,?,?,?,?)'
  ).run(signalId, buyerName, buyerEmail, accessToken, 'pending', 'pending', ts);
  return getOrder(r.lastInsertRowid);
}

function getOrder(id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id) || null;
}

function getOrderByToken(token) {
  return db.prepare('SELECT * FROM orders WHERE access_token = ?').get(token) || null;
}

function getOrderBySession(sessionId) {
  return db.prepare('SELECT * FROM orders WHERE stripe_session_id = ?').get(sessionId) || null;
}

function setOrderSession(id, sessionId) {
  db.prepare('UPDATE orders SET stripe_session_id = ? WHERE id = ?').run(sessionId, id);
  return getOrder(id);
}

function markOrderPaid(id, paymentIntent) {
  const ts = nowIso();
  db.prepare("UPDATE orders SET status = 'paid', stripe_payment_intent = ?, paid_at = ? WHERE id = ?")
    .run(paymentIntent || null, ts, id);
  return getOrder(id);
}

function setOrderEmailStatus(id, emailStatus, error) {
  db.prepare('UPDATE orders SET email_status = ?, email_error = ? WHERE id = ?')
    .run(emailStatus, error || null, id);
  return getOrder(id);
}

function listOrders() {
  return db.prepare(`
    SELECT o.*, s.pair AS signal_pair, s.direction AS signal_direction
    FROM orders o JOIN signals s ON s.id = o.signal_id
    ORDER BY o.created_at DESC
  `).all();
}

function countWonLost() {
  const row = db.prepare(
    "SELECT SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) AS won, SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) AS lost FROM signals"
  ).get();
  return { won: row.won || 0, lost: row.lost || 0 };
}

module.exports = {
  db, nowIso, createSignal, getSignal, listSignals, setSignalStatus, deleteSignal,
  createOrder, getOrder, getOrderByToken, getOrderBySession, setOrderSession,
  markOrderPaid, setOrderEmailStatus, listOrders, countWonLost,
};
