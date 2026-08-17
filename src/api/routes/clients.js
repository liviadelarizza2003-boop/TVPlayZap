'use strict';
const express      = require('express');
const db           = require('../../db/db');
const bot          = require('../../bot/index');
const { requireAuth } = require('./auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

function formatDate(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

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

// ══════════════════════════════════════════════════════════
//  CANDIDATAS (clientes sugeridos a partir do histórico)
//  — precisa vir antes de "/:id" pra não colidir com o path
// ══════════════════════════════════════════════════════════

/** GET /api/clients/candidates — lista pendentes */
router.get('/candidates', asyncHandler(async (_req, res) => {
  const rows = await db.all(
    "SELECT * FROM client_candidates WHERE status = 'pending' ORDER BY created_at ASC"
  );
  res.json(rows.map(r => ({
    ...r,
    source_messages: r.source_messages ? JSON.parse(r.source_messages) : '',
  })));
}));

/** GET /api/clients/candidates/count — contagem de pendentes (badge do menu) */
router.get('/candidates/count', asyncHandler(async (_req, res) => {
  const row = await db.get("SELECT COUNT(*) as count FROM client_candidates WHERE status = 'pending'");
  res.json({ count: Number(row?.count) || 0 });
}));

/** POST /api/clients/candidates/:id/approve — aprova e cria o cliente real */
router.post('/candidates/:id/approve', asyncHandler(async (req, res) => {
  const candidate = await db.get('SELECT * FROM client_candidates WHERE id = ?', [req.params.id]);
  if (!candidate) return res.status(404).json({ error: 'Sugestão não encontrada' });

  const name     = (req.body?.name     || candidate.name || '').trim();
  const plan     = (req.body?.plan     || candidate.plan || '').trim();
  const due_date = req.body?.due_date  || candidate.due_date || null;

  if (!name) return res.status(400).json({ error: 'Nome é obrigatório para aprovar' });

  try {
    const result = await db.run(
      `INSERT INTO clients (name, phone, plan, due_date) VALUES (?, ?, ?, ?) RETURNING id`,
      [name, candidate.phone, plan || null, due_date]
    );

    await db.run(
      "UPDATE client_candidates SET status = 'approved', reviewed_at = now() WHERE id = ?",
      [req.params.id]
    );

    res.status(201).json({
      ok: true,
      clientId: result.rows[0].id,
      message: 'Cliente aprovado e cadastrado!',
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe um cliente com este telefone' });
    }
    throw err;
  }
}));

/** POST /api/clients/candidates/:id/reject — descarta sugestão */
router.post('/candidates/:id/reject', asyncHandler(async (req, res) => {
  const candidate = await db.get('SELECT id FROM client_candidates WHERE id = ?', [req.params.id]);
  if (!candidate) return res.status(404).json({ error: 'Sugestão não encontrada' });

  await db.run(
    "UPDATE client_candidates SET status = 'rejected', reviewed_at = now() WHERE id = ?",
    [req.params.id]
  );
  res.json({ ok: true });
}));

/** GET /api/clients/:id */
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Cliente não encontrado' });
  res.json(row);
}));

/** POST /api/clients — cria cliente */
router.post('/', asyncHandler(async (req, res) => {
  const { name, phone, plan, due_date, notes, is_trial } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: 'Nome e telefone são obrigatórios' });

  // Normaliza telefone: só dígitos, com código do país
  const phoneCleaned = phone.replace(/\D/g, '');
  const startTrial = !!is_trial;

  try {
    const result = await db.run(
      `INSERT INTO clients (name, phone, plan, due_date, notes, is_trial, trial_started_at)
       VALUES (?, ?, ?, ?, ?, ?, ${startTrial ? 'now()' : 'NULL'}) RETURNING id`,
      [name.trim(), phoneCleaned, plan?.trim() || null, due_date || null, notes?.trim() || null, startTrial ? 1 : 0]
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

/** POST /api/clients/:id/send-reminder — envia a mensagem de lembrete agora, manualmente */
router.post('/:id/send-reminder', asyncHandler(async (req, res) => {
  const client = await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!client) return res.status(404).json({ error: 'Cliente não encontrado' });

  const template = (await db.get("SELECT value FROM config WHERE key = 'reminder_message'"))?.value ||
    'Olá, {name}! 👋 Seu plano *{plan}* vence dia *{due_date}*. Quer renovar? 😊';

  const msg = renderTemplate(template, {
    name:     client.name,
    plan:     client.plan || 'seu plano',
    due_date: formatDate(client.due_date),
  });

  const whatsappId = client.phone.includes('@') ? client.phone : `${client.phone}@s.whatsapp.net`;

  await bot.sendMessage(whatsappId, msg);

  await db.run(
    `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'manual_reminder')`,
    [client.phone, msg]
  );

  // Marca como "já lembrado" pra esse vencimento, evitando lembrete duplicado do cron automático
  if (client.due_date) {
    await db.run(
      `INSERT INTO renewal_notifications (client_id, due_date, status) VALUES (?, ?, 'sent')`,
      [client.id, client.due_date]
    );
  }

  res.json({ ok: true, message: msg });
}));

/** POST /api/clients/:id/renew — registra renovação, recalcula vencimento a partir de hoje */
router.post('/:id/renew', asyncHandler(async (req, res) => {
  const existing = await db.get('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Cliente não encontrado' });

  const cycleDays = parseInt((await db.get("SELECT value FROM config WHERE key = 'renewal_cycle_days'"))?.value || '30');
  const next = new Date();
  next.setDate(next.getDate() + cycleDays);
  const newDueDate = next.toISOString().split('T')[0];

  await db.run(
    `UPDATE clients SET due_date = ?, is_trial = 0, is_active = 1, updated_at = now() WHERE id = ?`,
    [newDueDate, req.params.id]
  );

  res.json(await db.get('SELECT * FROM clients WHERE id = ?', [req.params.id]));
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
