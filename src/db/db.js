'use strict';
const path   = require('path');
const fs     = require('fs');
// node:sqlite está embutido no Node.js 22.5+ — sem compilação nativa necessária
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'livia.db');
const db = new DatabaseSync(DB_PATH);

// WAL mode: leituras não bloqueiam escritas (importante com o Baileys
// gravando mensagens ao mesmo tempo que o painel faz queries).
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// Roda o schema na inicialização — CREATE TABLE IF NOT EXISTS é idempotente
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ─── API helper (mesma interface do wrapper anterior) ────────────────────────

/** SELECT múltiplas linhas */
function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

/** SELECT uma linha */
function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

/** INSERT / UPDATE / DELETE */
function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** Executa dentro de uma transação atômica */
function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { all, get, run, transaction, _db: db };

