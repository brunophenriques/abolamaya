const express = require('express');
const path    = require('path');
const db      = require('./db');
const { auth } = require('./middleware/auth');
const { PORT } = require('./config');
const { startScheduler } = require('./scraper/scheduler');

const app = express();
app.use(express.json());

// Serve frontend files
app.use(express.static(path.join(__dirname, '..')));

// API routes
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/matches',     require('./routes/matches'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/lobbies',     require('./routes/lobbies'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/football',       require('./routes/football'));
app.use('/api/national-teams', require('./routes/national-teams'));
app.use('/api/profile',        require('./routes/profile'));
app.use('/api/friends',        require('./routes/friends'));

// GET /api/me
app.get('/api/me', auth, (req, res) => {
  const user = db.prepare(
    'SELECT id,username,display_name,is_admin,bio,avatar_color,created_at FROM users WHERE id=?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' });
  res.json({ ...user, is_admin: !!user.is_admin });
});

app.listen(PORT, () => {
  console.log(`\n⚽  A Bola Maya a correr em http://localhost:${PORT}\n`);
  startScheduler(db);
});
