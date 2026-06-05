const express   = require('express');
const path      = require('path');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const db        = require('./db');
const { auth }  = require('./middleware/auth');
const { PORT }  = require('./config');
const { startScheduler } = require('./scraper/scheduler');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // disabled — inline scripts in HTML pages
  crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '50kb' }));

// Rate limiting on auth and ticket submission
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas tentativas. Tenta novamente em 15 minutos.' },
});
const ticketLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados reportes enviados. Tenta mais tarde.' },
});

// Serve frontend files
app.use(express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/auth',        authLimiter, require('./routes/auth'));
app.use('/api/tickets',     ticketLimiter, require('./routes/tickets'));
app.use('/api/matches',     require('./routes/matches'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/lobbies',     require('./routes/lobbies'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/football',       require('./routes/football'));
app.use('/api/national-teams', require('./routes/national-teams'));
app.use('/api/profile',        require('./routes/profile'));
app.use('/api/friends',        require('./routes/friends'));
app.use('/api/notifications',  require('./routes/notifications'));
app.use('/api/upload',         require('./routes/upload'));
app.use('/api/player-stats',   require('./routes/playerStats'));
app.use('/api/auth',           require('./routes/oauth'));   // OAuth callbacks (same prefix as auth)

// GET /api/me
app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id,username,display_name,is_admin,bio,avatar_color,avatar_url,created_at,profile_public,history_public FROM users WHERE id=?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' });
  res.json({ ...user, is_admin: !!user.is_admin });
});

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[error]', err.message || err);
  if (req.path.startsWith('/api')) {
    return res.status(err.status || 500).json({ error: 'Erro interno. Tenta novamente mais tarde.' });
  }
  res.status(500).sendFile(path.join(__dirname, '..', '404.html'));
});

app.listen(PORT, () => {
  console.log(`\n⚽  A Bola Maya a correr em http://localhost:${PORT}\n`);
  startScheduler(db);
});
