'use strict';
const express     = require('express');
const bcrypt      = require('bcryptjs');
const jwt         = require('jsonwebtoken');
const db          = require('../../db/db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();
const JWT_SECRET  = () => process.env.JWT_SECRET || 'livia-secret';
const JWT_EXPIRES = '30d';

const UPSERT_CONFIG =
  'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';

/** POST /api/auth/login */
router.post('/login', asyncHandler(async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Senha obrigatória' });

  const storedHash = (await db.get("SELECT value FROM config WHERE key = 'admin_password_hash'"))?.value;

  // Primeiro acesso: usa ADMIN_PASSWORD do .env e grava o hash
  if (!storedHash) {
    const envPass = process.env.ADMIN_PASSWORD || 'livia123';
    if (password !== envPass) return res.status(401).json({ error: 'Senha incorreta' });

    const hash = bcrypt.hashSync(password, 10);
    await db.run(UPSERT_CONFIG, ['admin_password_hash', hash]);
  } else {
    if (!bcrypt.compareSync(password, storedHash)) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET(), { expiresIn: JWT_EXPIRES });
  res
    .cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 })
    .json({ ok: true });
}));

/** POST /api/auth/logout */
router.post('/logout', (_req, res) => {
  res.clearCookie('token').json({ ok: true });
});

/** POST /api/auth/change-password */
router.post('/change-password', requireAuth, asyncHandler(async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run(UPSERT_CONFIG, ['admin_password_hash', hash]);
  res.json({ ok: true });
}));

/**
 * POST /api/auth/reset-password
 * Reset de emergência (sem precisar da senha atual) usando a RECOVERY_KEY
 * definida em variável de ambiente. Não requer login.
 */
router.post('/reset-password', asyncHandler(async (req, res) => {
  const { recoveryKey, newPassword } = req.body || {};
  const expected = process.env.RECOVERY_KEY;

  if (!expected) {
    return res.status(503).json({ error: 'Reset de senha não configurado (RECOVERY_KEY ausente)' });
  }
  if (!recoveryKey || recoveryKey !== expected) {
    return res.status(401).json({ error: 'Chave de recuperação incorreta' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  await db.run(UPSERT_CONFIG, ['admin_password_hash', hash]);
  res.json({ ok: true });
}));

// ── Pergunta secreta (segunda forma de recuperar a senha) ───────────────
// A pergunta fica em texto puro (`security_question`) porque precisa ser
// exibida na tela de login pra quem esqueceu a senha; a resposta só existe
// como hash bcrypt (`security_answer_hash`), normalizada antes de comparar
// (sem acento, sem maiúsculas, espaços colapsados) pra "São Paulo", "sao
// paulo" e " SAO  PAULO " valerem a mesma coisa.

const MIN_QUESTION_LEN = 5;
const MIN_ANSWER_LEN   = 4;

// Resposta de pergunta secreta tem pouca entropia — sem trava, dá pra
// adivinhar por tentativa e erro. Contador em memória e global (o painel é
// de usuário único, então não há "por IP" a distinguir); zera num restart do
// servidor, o que um atacante externo não consegue provocar.
const MAX_QUESTION_ATTEMPTS = 5;
const QUESTION_LOCK_MS      = 15 * 60 * 1000;
const questionAttempts = { failures: 0, lockedUntil: 0 };

function normalizeAnswer(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** GET /api/auth/recovery-question — pública: a tela de login precisa exibir a pergunta */
router.get('/recovery-question', asyncHandler(async (_req, res) => {
  const question   = (await db.get("SELECT value FROM config WHERE key = 'security_question'"))?.value;
  const answerHash = (await db.get("SELECT value FROM config WHERE key = 'security_answer_hash'"))?.value;
  if (!question || !answerHash) return res.json({ enabled: false });
  res.json({ enabled: true, question });
}));

/**
 * POST /api/auth/security-question
 * Define/troca a pergunta secreta. Exige login E a senha atual: sem isso,
 * uma sessão esquecida aberta (o cookie dura 30 dias) bastaria pra plantar
 * uma resposta conhecida e tomar a conta depois.
 */
router.post('/security-question', requireAuth, asyncHandler(async (req, res) => {
  const { question, answer, currentPassword } = req.body || {};
  const cleanQuestion = String(question ?? '').trim();
  const cleanAnswer   = normalizeAnswer(answer);

  if (cleanQuestion.length < MIN_QUESTION_LEN) {
    return res.status(400).json({ error: `A pergunta deve ter ao menos ${MIN_QUESTION_LEN} caracteres` });
  }
  if (cleanAnswer.length < MIN_ANSWER_LEN) {
    return res.status(400).json({ error: `A resposta deve ter ao menos ${MIN_ANSWER_LEN} caracteres` });
  }

  const storedHash = (await db.get("SELECT value FROM config WHERE key = 'admin_password_hash'"))?.value;
  if (!currentPassword || !storedHash || !bcrypt.compareSync(currentPassword, storedHash)) {
    // 403 (não 401): o front trata 401 como "sessão expirou" e volta pro login
    return res.status(403).json({ error: 'Senha atual incorreta' });
  }

  await db.run(UPSERT_CONFIG, ['security_question', cleanQuestion]);
  await db.run(UPSERT_CONFIG, ['security_answer_hash', bcrypt.hashSync(cleanAnswer, 10)]);
  res.json({ ok: true });
}));

/**
 * POST /api/auth/reset-password-by-question
 * Reset sem login, respondendo a pergunta secreta. Bloqueia por 15 min
 * depois de 5 respostas erradas seguidas.
 */
router.post('/reset-password-by-question', asyncHandler(async (req, res) => {
  const { answer, newPassword } = req.body || {};

  const now = Date.now();
  if (questionAttempts.lockedUntil > now) {
    const minutes = Math.ceil((questionAttempts.lockedUntil - now) / 60000);
    return res.status(429).json({
      error: `Muitas tentativas erradas. Tente de novo em ${minutes} min ou use a chave de recuperação.`,
    });
  }

  const answerHash = (await db.get("SELECT value FROM config WHERE key = 'security_answer_hash'"))?.value;
  if (!answerHash) {
    return res.status(503).json({ error: 'Pergunta secreta não configurada' });
  }
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  }

  if (!bcrypt.compareSync(normalizeAnswer(answer), answerHash)) {
    questionAttempts.failures += 1;
    if (questionAttempts.failures >= MAX_QUESTION_ATTEMPTS) {
      questionAttempts.lockedUntil = now + QUESTION_LOCK_MS;
      questionAttempts.failures = 0;
    }
    return res.status(401).json({ error: 'Resposta incorreta' });
  }

  questionAttempts.failures = 0;
  await db.run(UPSERT_CONFIG, ['admin_password_hash', bcrypt.hashSync(newPassword, 10)]);
  res.json({ ok: true });
}));

/** Middleware de autenticação — exportado para uso nos outros routers */
function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    req.user = jwt.verify(token, JWT_SECRET());
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.normalizeAnswer = normalizeAnswer;
module.exports._questionAttempts = questionAttempts; // só pra teste
