// База данных SQLite (встроенный node:sqlite)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'registry.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  num TEXT,
  date TEXT,
  customer TEXT,
  customer_inn TEXT,
  supplier TEXT,
  supplier_inn TEXT,
  ikz TEXT,
  total REAL,
  vat_rate TEXT,
  status TEXT DEFAULT 'active',
  source_pdf TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL,
  num INTEGER,
  name TEXT,
  unit TEXT,
  qty REAL,
  price REAL,
  sum REAL,
  okpd2 TEXT,
  gost TEXT,
  chars TEXT,
  FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS mail_seen (
  message_id TEXT PRIMARY KEY,
  contract_id INTEGER,
  subject TEXT,
  imported_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = { db, DATA_DIR };
