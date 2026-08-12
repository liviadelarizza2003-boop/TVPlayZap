'use strict';
const express = require('express');
const db      = require('../../db/db');
const { requireAuth } = require('./auth');
const { checkAndSend } = require('../../scheduler/renewalReminder');

const router = express.Router();
router.use(requireAuth);

const EDITABLE_KEYS = [
  'business_name', 'owner_phone', 'working_hours_start', 'working_hours_end',
  'fallback_message', 'off_hours_message', 'reminder_message',
];

/** GET /api/config */
router.get('/', (_req, res) => {
  const rows = db.all('SELECT key, value FROM config WHERE key IN (' +
    EDITABLE_KEYS.map(() => '?').join(',') + ')', EDITABLE_KEYS);
  const cfg = {};
  for (const { key, value } of rows) cfg[key] = value;
  res.json(cfg);
});

/** PATCH /api/config — atualiza uma ou mais chaves */
router.patch('/', (req, res) => {
  const updates = req.body || {};
  for (const [key, value] of Object.entries(updates)) {
    if (!EDITABLE_KEYS.includes(key)) continue;
    db.run(
      "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))",
      [key, String(value)]
    );
  }
  res.json({ ok: true });
});

/** GET /api/config/stats — dados do dashboard */
router.get('/stats', (_req, res) => {
  const today   = new Date().toISOString().split('T')[0];
  const in3days = new Date(); in3days.setDate(in3days.getDate() + 3);
  const in3str  = in3days.toISOString().split('T')[0];
  const in7days = new Date(); in7days.setDate(in7days.getDate() + 7);
  const in7str  = in7days.toISOString().split('T')[0];

  const totalClients   = db.get('SELECT COUNT(*) as n FROM clients WHERE is_active = 1')?.n || 0;
  const expiringToday  = db.get('SELECT COUNT(*) as n FROM clients WHERE due_date = ? AND is_active = 1', [today])?.n || 0;
  const expiring3days  = db.get('SELECT COUNT(*) as n FROM clients WHERE due_date BETWEEN ? AND ? AND is_active = 1', [today, in3str])?.n || 0;
  const expiring7days  = db.get('SELECT COUNT(*) as n FROM clients WHERE due_date BETWEEN ? AND ? AND is_active = 1', [today, in7str])?.n || 0;
  const totalFaq       = db.get('SELECT COUNT(*) as n FROM faq WHERE is_active = 1')?.n || 0;
  const pendingTraining= db.get("SELECT COUNT(*) as n FROM faq_candidates WHERE status = 'pending'")?.n || 0;
  const msgToday       = db.get("SELECT COUNT(*) as n FROM messages_log WHERE direction = 'inbound' AND date(sent_at) = ?", [today])?.n || 0;
  const autoAnswered   = db.get("SELECT COUNT(*) as n FROM messages_log WHERE direction = 'outbound' AND answered_by = 'faq' AND date(sent_at) = ?", [today])?.n || 0;

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
});

/** POST /api/config/test-reminder — força envio de lembretes (teste manual) */
router.post('/test-reminder', async (_req, res) => {
  try {
    const result = await checkAndSend();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
