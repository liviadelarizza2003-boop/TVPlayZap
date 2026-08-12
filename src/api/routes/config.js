'use strict';
const express = require('express');
const db      = require('../../db/db');
const { requireAuth } = require('./auth');
const { checkAndSend } = require('../../scheduler/renewalReminder');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

const EDITABLE_KEYS = [
  'business_name', 'owner_phone', 'working_hours_start', 'working_hours_end',
  'fallback_message', 'off_hours_message', 'reminder_message',
];

/** GET /api/config */
router.get('/', asyncHandler(async (_req, res) => {
  const rows = await db.all('SELECT key, value FROM config WHERE key IN (' +
    EDITABLE_KEYS.map(() => '?').join(',') + ')', EDITABLE_KEYS);
  const cfg = {};
  for (const { key, value } of rows) cfg[key] = value;
  res.json(cfg);
}));

/** PATCH /api/config — atualiza uma ou mais chaves */
router.patch('/', asyncHandler(async (req, res) => {
  const updates = req.body || {};
  for (const [key, value] of Object.entries(updates)) {
    if (!EDITABLE_KEYS.includes(key)) continue;
    await db.run(
      `INSERT INTO config (key, value, updated_at) VALUES (?, ?, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [key, String(value)]
    );
  }
  res.json({ ok: true });
}));

/** GET /api/config/stats — dados do dashboard */
router.get('/stats', asyncHandler(async (_req, res) => {
  const today   = new Date().toISOString().split('T')[0];
  const in3days = new Date(); in3days.setDate(in3days.getDate() + 3);
  const in3str  = in3days.toISOString().split('T')[0];
  const in7days = new Date(); in7days.setDate(in7days.getDate() + 7);
  const in7str  = in7days.toISOString().split('T')[0];

  // COUNT(*) volta como string (bigint) no driver do pg — normaliza pra number
  const count = async (sql, params) => Number((await db.get(sql, params))?.n) || 0;

  const totalClients    = await count('SELECT COUNT(*) as n FROM clients WHERE is_active = 1');
  const expiringToday   = await count('SELECT COUNT(*) as n FROM clients WHERE due_date = ? AND is_active = 1', [today]);
  const expiring3days   = await count('SELECT COUNT(*) as n FROM clients WHERE due_date BETWEEN ? AND ? AND is_active = 1', [today, in3str]);
  const expiring7days   = await count('SELECT COUNT(*) as n FROM clients WHERE due_date BETWEEN ? AND ? AND is_active = 1', [today, in7str]);
  const totalFaq        = await count('SELECT COUNT(*) as n FROM faq WHERE is_active = 1');
  const pendingTraining = await count("SELECT COUNT(*) as n FROM faq_candidates WHERE status = 'pending'");
  const msgToday        = await count("SELECT COUNT(*) as n FROM messages_log WHERE direction = 'inbound' AND sent_at::date = ?", [today]);
  const autoAnswered    = await count("SELECT COUNT(*) as n FROM messages_log WHERE direction = 'outbound' AND answered_by = 'faq' AND sent_at::date = ?", [today]);

  res.json({
    totalClients,
    expiringToday,
    expiring3days,
    expiring7days,
    totalFaq,
    pendingTraining,
    msgToday,
    autoAnswered,
  });
}));

/** POST /api/config/test-reminder — força envio de lembretes (teste manual) */
router.post('/test-reminder', asyncHandler(async (_req, res) => {
  const result = await checkAndSend();
  res.json(result);
}));

module.exports = router;
