const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const db = require('../db');

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    // Read is_admin fresh from DB — JWT may be stale if admin was promoted after login
    const row = db.prepare('SELECT is_admin FROM users WHERE id=?').get(payload.id);
    if (!row) return res.status(401).json({ error: 'Utilizador não encontrado' });
    req.user = { ...payload, is_admin: !!row.is_admin };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

module.exports = { auth, requireAdmin };
