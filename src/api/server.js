'use strict';
/**
 * api/server.js — Servidor principal do Eva Lite (Livia Bot)
 *
 * Inicializa na ordem:
 *  1. Express + middlewares
 *  2. Rotas da API REST
 *  3. WebSocket (QR Code do WhatsApp)
 *  4. Servir o frontend PWA como static files
 *  5. Bot WhatsApp (Baileys)
 *  6. Cron de lembretes de vencimento
 */

require('dotenv').config();

const path         = require('path');
const http         = require('http');
const express      = require('express');
const cookieParser = require('cookie-parser');
const { WebSocketServer } = require('ws');

const db = require('../db/db');
const asyncHandler = require('./asyncHandler');

// Rotas
const authRouter      = require('./routes/auth');
const clientsRouter   = require('./routes/clients');
const faqRouter       = require('./routes/faq');
const onboardingRouter= require('./routes/onboarding');
const configRouter    = require('./routes/config');
const { requireAuth } = require('./routes/auth');

// Bot e scheduler
const bot             = require('../bot/index');
const { startScheduler } = require('../scheduler/renewalReminder');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3200;

// ── Middlewares ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());

// ── Rotas da API ───────────────────────────────────────────────────────────
app.use('/api/auth',       authRouter);
app.use('/api/clients',    clientsRouter);
app.use('/api/faq',        faqRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/config',     configRouter);

// ── Status do bot (autenticado) ────────────────────────────────────────────
app.get('/api/bot/status', requireAuth, (_req, res) => {
  res.json(bot.getStatus());
});

// ── Código de pareamento (alternativa ao QR Code) ──────────────────────────
app.post('/api/bot/pairing-code', requireAuth, asyncHandler(async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) return res.status(400).json({ error: 'Telefone obrigatório' });
  const code = await bot.requestPairingCode(phone);
  res.json({ code });
}));

// ── Frontend PWA (arquivos estáticos) ─────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '../../frontend');
app.use(express.static(FRONTEND_DIR));

// SPA fallback: qualquer rota não-API serve o index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ── WebSocket — QR Code em tempo real ─────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/qr' });

wss.on('connection', (ws) => {
  console.log('[ws] Cliente conectado ao QR WebSocket');
  bot.addQrListener(ws);
});

// ── Tratamento de erros da API (deve ser o último middleware) ──────────────
app.use((err, _req, res, _next) => {
  console.error('[api] Erro:', err);
  res.status(500).json({ error: err.message || 'Erro interno' });
});

// ── Inicialização ──────────────────────────────────────────────────────────
db.initSchema()
  .then(() => {
    server.listen(PORT, async () => {
      console.log(`\n🌸 Livia Bot rodando em http://localhost:${PORT}\n`);

      // Inicia bot WhatsApp (não bloqueante)
      bot.connect().catch(err => console.error('[server] Erro ao iniciar bot:', err));

      // Inicia cron de lembretes
      startScheduler();
    });
  })
  .catch(err => {
    console.error('[server] Falha ao inicializar banco de dados:', err);
    process.exit(1);
  });

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Recebido SIGTERM. Encerrando...');
  server.close(() => process.exit(0));
});
