'use strict';
const express = require('express');
const db      = require('../../db/db');
const { requireAuth } = require('./auth');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
router.use(requireAuth);

// ══════════════════════════════════════════════════════════
//  FAQ ATIVO
// ══════════════════════════════════════════════════════════

/** GET /api/faq */
router.get('/', asyncHandler(async (_req, res) => {
  res.json(await db.all('SELECT * FROM faq ORDER BY usage_count DESC, question ASC'));
}));

/** POST /api/faq — cria entrada */
router.post('/', asyncHandler(async (req, res) => {
  const { question, answer, keywords } = req.body || {};
  if (!question || !answer) {
    return res.status(400).json({ error: 'Pergunta e resposta são obrigatórias' });
  }
  const result = await db.run(
    'INSERT INTO faq (question, answer, keywords) VALUES (?, ?, ?) RETURNING id',
    [question.trim(), answer.trim(), keywords?.trim() || null]
  );
  res.status(201).json(await db.get('SELECT * FROM faq WHERE id = ?', [result.rows[0].id]));
}));

/** PATCH /api/faq/:id */
router.patch('/:id', asyncHandler(async (req, res) => {
  const { question, answer, keywords, is_active } = req.body || {};
  const row = await db.get('SELECT id FROM faq WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Entrada não encontrada' });

  await db.run(
    `UPDATE faq SET
       question   = COALESCE(?, question),
       answer     = COALESCE(?, answer),
       keywords   = COALESCE(?, keywords),
       is_active  = COALESCE(?, is_active),
       updated_at = now()
     WHERE id = ?`,
    [
      question?.trim() || null,
      answer?.trim()   || null,
      keywords != null ? (keywords.trim() || null) : null,
      is_active != null ? (is_active ? 1 : 0) : null,
      req.params.id,
    ]
  );
  res.json(await db.get('SELECT * FROM faq WHERE id = ?', [req.params.id]));
}));

/** DELETE /api/faq/:id */
router.delete('/:id', asyncHandler(async (req, res) => {
  const row = await db.get('SELECT id FROM faq WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Entrada não encontrada' });
  await db.run('DELETE FROM faq WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ══════════════════════════════════════════════════════════
//  CANDIDATAS (Treinar a Livia)
// ══════════════════════════════════════════════════════════

/** GET /api/faq/candidates — lista pendentes */
router.get('/candidates', asyncHandler(async (_req, res) => {
  const rows = await db.all(
    "SELECT * FROM faq_candidates WHERE status = 'pending' ORDER BY created_at ASC"
  );
  // Parseia source_messages de JSON string para array
  res.json(rows.map(r => ({
    ...r,
    source_messages: r.source_messages ? JSON.parse(r.source_messages) : [],
  })));
}));

/** GET /api/faq/candidates/count — contagem de pendentes (badge do menu) */
router.get('/candidates/count', asyncHandler(async (_req, res) => {
  const row = await db.get("SELECT COUNT(*) as count FROM faq_candidates WHERE status = 'pending'");
  res.json({ count: Number(row?.count) || 0 });
}));

/** POST /api/faq/candidates/:id/approve — aprova e move para o FAQ ativo */
router.post('/candidates/:id/approve', asyncHandler(async (req, res) => {
  const candidate = await db.get('SELECT * FROM faq_candidates WHERE id = ?', [req.params.id]);
  if (!candidate) return res.status(404).json({ error: 'Candidata não encontrada' });

  // Usa versão editada se enviada, senão usa a original da IA
  const question = (req.body?.question || candidate.question).trim();
  const answer   = (req.body?.answer   || candidate.answer).trim();

  const result = await db.run(
    'INSERT INTO faq (question, answer) VALUES (?, ?) RETURNING id',
    [question, answer]
  );

  await db.run(
    "UPDATE faq_candidates SET status = 'approved', reviewed_at = now() WHERE id = ?",
    [req.params.id]
  );

  res.status(201).json({
    ok: true,
    faqId: result.rows[0].id,
    message: 'Resposta aprovada e adicionada ao FAQ!',
  });
}));

/** POST /api/faq/candidates/:id/reject — descarta candidata */
router.post('/candidates/:id/reject', asyncHandler(async (req, res) => {
  const candidate = await db.get('SELECT id FROM faq_candidates WHERE id = ?', [req.params.id]);
  if (!candidate) return res.status(404).json({ error: 'Candidata não encontrada' });

  await db.run(
    "UPDATE faq_candidates SET status = 'rejected', reviewed_at = now() WHERE id = ?",
    [req.params.id]
  );
  res.json({ ok: true });
}));

module.exports = router;
