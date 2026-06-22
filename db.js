// Banco de dados SQLite (Fase 2) — contas por produto, códigos e logs.
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT UNIQUE NOT NULL,
  product_id  INTEGER NOT NULL,
  plan        TEXT NOT NULL,
  usage_limit INTEGER,            -- NULL = ilimitado
  duration_days INTEGER,          -- validade da conta a partir do cadastro; NULL = vitalício
  status      TEXT NOT NULL DEFAULT 'unused',  -- unused | redeemed
  source      TEXT NOT NULL DEFAULT 'manual',  -- manual | cakto
  external_ref TEXT,                           -- id da transação na Cakto (p/ a página de obrigado)
  created_at  TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  product_id    INTEGER NOT NULL,
  plan          TEXT NOT NULL,
  usage_limit   INTEGER,          -- NULL = ilimitado
  usage_count   INTEGER NOT NULL DEFAULT 0,
  expires_at    TEXT,             -- ISO; NULL = sem expiração
  code          TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (email, product_id),     -- conta por produto: mesmo email pode existir em produtos diferentes
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  product_id INTEGER,
  type       TEXT, tone TEXT, goal TEXT,
  created_at TEXT NOT NULL
);
`);

// Migração leve: garante a coluna external_ref em bancos já existentes.
const codeCols = db.prepare('PRAGMA table_info(codes)').all().map(c => c.name);
if (!codeCols.includes('external_ref')) {
  db.exec('ALTER TABLE codes ADD COLUMN external_ref TEXT');
}

// Planos padrão (usados pelo admin e pela Cakto para definir limite/validade).
const PLANS = {
  starter:   { usage_limit: 50,   duration_days: 7 },
  pro:       { usage_limit: null, duration_days: 30 },
  vitalicio: { usage_limit: null, duration_days: null },
};

const nowISO = () => new Date().toISOString();

// ---- Produtos ----
function ensureProduct(slug, name) {
  let p = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
  if (!p) {
    db.prepare('INSERT INTO products (slug, name, created_at) VALUES (?,?,?)').run(slug, name, nowISO());
    p = db.prepare('SELECT * FROM products WHERE slug = ?').get(slug);
  }
  return p;
}
function getProductBySlug(slug) { return db.prepare('SELECT * FROM products WHERE slug = ?').get(slug); }

// ---- Códigos ----
function genCodeString(prefix = 'RIZZ') {
  const part = () => crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefix}-${part()}-${part()}`;
}
function createCode({ productId, plan, source = 'manual', code, externalRef = null }) {
  const cfg = PLANS[plan];
  if (!cfg) throw new Error('Plano inválido');
  const value = code || genCodeString();
  db.prepare(`INSERT INTO codes (code, product_id, plan, usage_limit, duration_days, source, external_ref, created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(value, productId, plan, cfg.usage_limit, cfg.duration_days, source, externalRef, nowISO());
  return db.prepare('SELECT * FROM codes WHERE code = ?').get(value);
}
function getCode(code) { return db.prepare('SELECT * FROM codes WHERE code = ?').get(code); }
function getCodeByRef(ref) { return db.prepare('SELECT * FROM codes WHERE external_ref = ? ORDER BY id DESC LIMIT 1').get(ref); }
function markCodeRedeemed(code) { db.prepare("UPDATE codes SET status='redeemed' WHERE code=?").run(code); }
function listCodes() { return db.prepare('SELECT * FROM codes ORDER BY created_at DESC').all(); }
function deleteCode(code) { db.prepare('DELETE FROM codes WHERE code=?').run(code); }

// ---- Usuários ----
function getUser(email, productId) {
  return db.prepare('SELECT * FROM users WHERE email=? AND product_id=?').get(email, productId);
}
function getUserById(id) { return db.prepare('SELECT * FROM users WHERE id=?').get(id); }
function createUser({ email, passwordHash, productId, plan, usageLimit, expiresAt, code }) {
  const info = db.prepare(`INSERT INTO users
      (email, password_hash, product_id, plan, usage_limit, usage_count, expires_at, code, created_at)
      VALUES (?,?,?,?,?,0,?,?,?)`)
    .run(email, passwordHash, productId, plan, usageLimit, expiresAt, code, nowISO());
  return getUserById(info.lastInsertRowid);
}
function incrementUsage(userId) { db.prepare('UPDATE users SET usage_count = usage_count + 1 WHERE id=?').run(userId); }
function listUsers() {
  return db.prepare(`SELECT u.id,u.email,u.plan,u.usage_limit,u.usage_count,u.expires_at,u.created_at,p.slug AS product
                     FROM users u JOIN products p ON p.id=u.product_id ORDER BY u.created_at DESC`).all();
}

// ---- Logs ----
function addLog({ userId, productId, type, tone, goal }) {
  db.prepare('INSERT INTO logs (user_id,product_id,type,tone,goal,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, productId, type, tone, goal, nowISO());
}
function listLogs(limit = 100) {
  return db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT ?').all(limit);
}

// Seed do primeiro produto.
ensureProduct('rizzai', 'StoryMatch AI (RizzAI)');

module.exports = {
  db, PLANS, nowISO,
  ensureProduct, getProductBySlug,
  genCodeString, createCode, getCode, getCodeByRef, markCodeRedeemed, listCodes, deleteCode,
  getUser, getUserById, createUser, incrementUsage, listUsers,
  addLog, listLogs,
};
