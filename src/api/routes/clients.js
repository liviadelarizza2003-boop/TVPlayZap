'use strict';
const express      = require('express');
const db           = require('../../db/db');
const { requireAuth } = require('./auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

/** GET /api/clients — lista todos os clientes */
router.get('/', asyncHandler(async (req, res) => {
  const { search, active } = req.query;
  let sql    = 'SELECT * FROM clients WHERE 1=1';
  const params = [];

  if (active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(active === 'true' || active === '1' ? 1 : 0);
  }
  if (search) {
    sql += ' AND (name LIKE ? OR phone LIKE ? OR plan LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  sql += ' ORDER BY due_date ASC, name ASC';

  res.json(await db.all(sql, params));
}));

/** GET /api/clients/expiring — clientes vencendo em N dias (padrão: 7) */
router.get('/expiring', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days || '7');
  const today  = new Date().toISOString().split('T')[0];
  const future = new Date();
  future.setDate(future.getDate() + days);
  const futureDate = future.toISOString().split('T')[0];

  const rows = await db.all(
    `SELECT * FROM clients
     WHERE due_date BETWEEN ? AND ? AND is_active = 1
     ORDER BY due_date ASC`,
    [today, futureDate]
  );
  res.json(rows);
}));

/** GET /api/clients/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado' });
  res.json(row);
}));

/** POST /api/clients — cria cliente */
router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, plan, due_date, notes } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });

  // Normaliza telefone: só dígitos, com código do país
  const phoneCleaned = phone.replace(/\D/g, '');

  try {
    const result = await db.run(
      `INSERT INTO clients (name, phone, plan, due_date, notes)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [name.trim(), phoneCleaned, plan?.trim() || null, due_date || null, notes?.trim() || null]
    );
    const created = await db.get('SELECT * FROM clients WHERE id = ?', [result.rows[0].id]);
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') { // unique_violation no Postgres
      return res.status(409).json({ error: 'Já existe um cliente com este telefone' });
    }
    throw err;
  }
}));

/** PATCH /api/clients/:id — atualiza cliente */
router.patch('/:id', asyncHandler(async (req, res) => {
  const { name, phone, plan, due_date, notes, is_active } = req.body || {};
  const existing = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Cliente não encontrado' });

  await db.run(
    `UPDATE clients SET
       name       = COALESCE(?, name),
       phone      = COALESCE(?, phone),
       plan       = COALESCE(?, plan),
       due_date   = COALESCE(?, due_date),
       notes      = COALESCE(?, notes),
       is_active  = COALESCE(?, is_active),
       updated_at = now()
     WHERE id = ?`,
    [
      name?.trim()       || null,
      phone?.replace(/\D/g,'') || null,
      plan?.trim()       || null,
      due_date           || null,
      notes?.trim()      || null,
      is_active != null ? (is_active ? 1 : 0) : null,
      req.params.id,
    ]
  );

  res.json(await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]));
}));

/** DELETE /api/clients/:id — remove cliente */
router.delete('/:id', asyncHandler(async (req, res) => {
  const existing = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Cliente não encontrado' });
  await db.run('DELETE FROM clients WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

module.exports = router;
