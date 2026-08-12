'use strict';
const express    = require('express');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const db         = require('../../db/db');

const router = express.Router();
const JWT_SECRET  = () => process.env.JWT_SECRET || 'livia-secret';
const JWT_EXPIRES = '30d';

/** POST /api/auth/login */
router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Senha obrigatória' });

  const storedHash = db.get("SELECT value FROM config WHERE key = 'admin_password_hash'")?.value;

  // Primeiro acesso: usa ADMIN_PASSWORD do .env e grava o hash
  if (!storedHash) {
    const envPass = process.env.ADMIN_PASSWORD || 'livia123';
    if (password !== envPass) return res.status(401).json({ error: 'Senha incorreta' });

    const hash = bcrypt.hashSync(password, 10);
    db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('admin_password_hash', ?)", [hash]);
  } else {
    if (!bcrypt.compareSync(password, storedHash)) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET(), { expiresIn: JWT_EXPIRES });
  res
    .cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 })
    .json({ ok: true });
});

/** POST /api/auth/logout */
router.post('/logout', (_req, res) => {
  res.clearCookie('token').json({ ok: true });
});

/** POST /api/auth/change-password */
router.post('/change-password', requireAuth, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.run("INSERT OR REPLACE INTO config (key, value) VALUES ('admin_password_hash', ?)", [hash]);
  res.json({ ok: true });
});

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
