const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const db = require('../db');

function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET);
    const row = db.prepare('SELECT is_admin, is_helper, banned FROM users WHERE id=?').get(payload.id);
    if (!row) return res.status(401).json({ error: 'Utilizador não encontrado' });
    if (row.banned) return res.status(403).json({ error: 'Conta suspensa. Contacta a administração.' });
    req.user = { ...payload, is_admin: !!row.is_admin, is_helper: !!row.is_helper };
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

function requireHelper(req, res, next) {
  if (!req.user?.is_admin && !req.user?.is_helper) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

function optionalAuth(req, res, next) {
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ')) {
    try {
      const payload = jwt.verify(h.slice(7), JWT_SECRET);
      const row = db.prepare('SELECT is_admin, is_helper FROM users WHERE id=?').get(payload.id);
      if (row) req.user = { ...payload, is_admin: !!row.is_admin, is_helper: !!row.is_helper };
    } catch {}
  }
  next();
}

module.exports = { auth, requireAdmin, requireHelper, optionalAuth };
