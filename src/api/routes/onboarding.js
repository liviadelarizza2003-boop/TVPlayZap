'use strict';
const express  = require('express');
const { requireAuth } = require('./auth');
const { runAnalysis, getState } = require('../../engine/historyAnalyzer');
const { runExtraction, getState: getClientExtractionState } = require('../../engine/clientExtractor');

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

/**
 * POST /api/onboarding/analyze-clients
 * Dispara a extração de clientes (nome/plano/vencimento) a partir do
 * histórico de conversas em background.
 */
router.post('/analyze-clients', (_req, res) => {
  const state = getClientExtractionState();
  if (state.running) {
    return res.status(409).json({
      error: 'Extração já em andamento',
      progress: state,
    });
  }

  runExtraction().catch(err =>
    console.error('[onboarding] Erro não capturado na extração de clientes:', err)
  );

  res.json({
    ok: true,
    message: 'Extração iniciada! Acompanhe o progresso em /api/onboarding/clients-status',
  });
});

/**
 * GET /api/onboarding/clients-status
 * Retorna progresso atual da extração de clientes.
 */
router.get('/clients-status', (_req, res) => {
  res.json(getClientExtractionState());
});

module.exports = router;
