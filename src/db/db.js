'use strict';
const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada — defina a connection string do Postgres (Supabase) no .env');
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

pool.on('error', (err) => {
  console.error('[db] Erro inesperado no pool do Postgres:', err.message);
});

/** Converte placeholders "?" (estilo SQLite, usado no resto do código) para "$1, $2, ..." (estilo Postgres) */
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** SELECT múltiplas linhas */
async function all(sql, params = []) {
  const result = await pool.query(toPgSql(sql), params);
  return result.rows;
}

/** SELECT uma linha */
async function get(sql, params = []) {
  const result = await pool.query(toPgSql(sql), params);
  return result.rows[0];
}

/** INSERT / UPDATE / DELETE — retorna o resultado bruto do pg (use `.rows[0].id` com RETURNING id) */
async function run(sql, params = []) {
  return pool.query(toPgSql(sql), params);
}

/** Executa uma função dentro de uma transação atômica, usando uma conexão dedicada do pool */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Cria as tabelas (idempotente) — chamado uma vez na inicialização do servidor */
async function initSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

module.exports = { all, get, run, transaction, initSchema, pool };
