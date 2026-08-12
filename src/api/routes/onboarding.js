'use strict';
const express  = require('express');
const db       = require('../../db/db');
const { requireAuth } = require('./auth');
const { runAnalysis, getState } = require('../../engine/historyAnalyzer');

const router = express.Router();
router.use(requireAuth);

/**
 * POST /api/onboarding/analyze
 * Dispara a análise de histórico em background.
 * Body opcional: { messages: string[] } — mensagens extras coladas pela Livia
 */
router.post('/analyze', (req, res) => {
  const state = getState();
  if (state.running) {
    return res.status(409).json({
      error: 'Análise já em andamento',
      progress: state,
    });
  }

  const extraMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];

  // Roda em background — não aguardamos
  runAnalysis(extraMessages).catch(err =>
    console.error('[onboarding] Erro não capturado:', err)
  );

  res.json({
    ok: true,
    message: 'Análise iniciada! Acompanhe o progresso em /api/onboarding/status',
  });
});

/**
 * GET /api/onboarding/status
 * Retorna progresso atual da análise.
 */
router.get('/status', (_req, res) => {
  res.json(getState());
});

module.exports = router;
