// Achievement definitions — each has a type key, display name, icon, description,
// and a check(db, userId) function that returns true if the user has earned it.

const ACHIEVEMENTS = [
  {
    type: 'first_prediction',
    name: 'Primeira Previsão',
    icon: '🎯',
    description: 'Fizeste a tua primeira previsão.',
    check: (db, uid) => db.prepare('SELECT 1 FROM match_predictions WHERE user_id=? LIMIT 1').get(uid),
  },
  {
    type: 'first_correct',
    name: 'Acertei!',
    icon: '✅',
    description: 'Acertaste no resultado de um jogo.',
    check: (db, uid) => db.prepare('SELECT 1 FROM match_predictions WHERE user_id=? AND points_earned>=1 LIMIT 1').get(uid),
  },
  {
    type: 'exact_score',
    name: 'Marcador Exato',
    icon: '💎',
    description: 'Acertaste no marcador exato de um jogo.',
    check: (db, uid) => db.prepare('SELECT 1 FROM match_predictions WHERE user_id=? AND points_earned=3 LIMIT 1').get(uid),
  },
  {
    type: 'ten_correct',
    name: '10 Certas',
    icon: '🔥',
    description: 'Acertaste em 10 resultados.',
    check: (db, uid) => {
      const r = db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE user_id=? AND points_earned>=1').get(uid);
      return r.n >= 10;
    },
  },
  {
    type: 'twenty_correct',
    name: '20 Certas',
    icon: '⚡',
    description: 'Acertaste em 20 resultados.',
    check: (db, uid) => {
      const r = db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE user_id=? AND points_earned>=1').get(uid);
      return r.n >= 20;
    },
  },
  {
    type: 'high_accuracy',
    name: 'Sniper',
    icon: '🎯',
    description: 'Mais de 70% de precisão com pelo menos 10 previsões.',
    check: (db, uid) => {
      const r = db.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN points_earned>=1 THEN 1 ELSE 0 END) AS correct
        FROM match_predictions WHERE user_id=? AND points_earned IS NOT NULL
      `).get(uid);
      return r.total >= 10 && (r.correct / r.total) >= 0.7;
    },
  },
  {
    type: 'perfect_group',
    name: 'Mestre do Grupo',
    icon: '🏆',
    description: 'Acertaste na ordem completa de um grupo (4/4).',
    check: (db, uid) =>
      db.prepare('SELECT 1 FROM group_points WHERE user_id=? AND points_earned=4 LIMIT 1').get(uid),
  },
  {
    type: 'five_streak',
    name: 'Em Chama',
    icon: '🔥',
    description: '5 previsões corretas consecutivas.',
    check: (db, uid) => {
      const preds = db.prepare(`
        SELECT mp.points_earned
        FROM match_predictions mp
        JOIN matches m ON m.id=mp.match_id
        WHERE mp.user_id=? AND mp.points_earned IS NOT NULL
        ORDER BY m.match_date, m.id
      `).all(uid);

      let streak = 0;
      for (const p of preds) {
        if (p.points_earned >= 1) { streak++; if (streak >= 5) return true; }
        else streak = 0;
      }
      return false;
    },
  },
  {
    type: 'first_friend',
    name: 'Não É de Ferro',
    icon: '👥',
    description: 'Adicionaste o teu primeiro amigo.',
    check: (db, uid) => db.prepare(`
      SELECT 1 FROM friends WHERE (requester_id=? OR addressee_id=?) AND status='accepted' LIMIT 1
    `).get(uid, uid),
  },
  {
    type: 'all_predictions',
    name: 'Completo',
    icon: '📋',
    description: 'Fizeste previsões para todos os 72 jogos.',
    check: (db, uid) => {
      const r = db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE user_id=?').get(uid);
      return r.n >= 72;
    },
  },
];

// Check all achievements for a user and award any newly earned ones.
// Returns an array of newly awarded achievement objects.
function checkAchievements(db, userId) {
  const earned = new Set(
    db.prepare('SELECT type FROM user_achievements WHERE user_id=?').all(userId).map(r => r.type)
  );

  const newlyEarned = [];
  const insert = db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, type) VALUES (?,?)');

  for (const ach of ACHIEVEMENTS) {
    if (earned.has(ach.type)) continue;
    try {
      if (ach.check(db, userId)) {
        insert.run(userId, ach.type);
        newlyEarned.push(ach);
      }
    } catch { /* ignore check errors */ }
  }

  return newlyEarned;
}

// Get all earned achievements for a user (with full metadata)
function getUserAchievements(db, userId) {
  const earned = db.prepare(
    'SELECT type, earned_at FROM user_achievements WHERE user_id=? ORDER BY earned_at'
  ).all(userId);

  const meta = Object.fromEntries(ACHIEVEMENTS.map(a => [a.type, a]));
  return earned.map(e => ({ ...meta[e.type], earned_at: e.earned_at })).filter(a => a.name);
}

module.exports = { ACHIEVEMENTS, checkAchievements, getUserAchievements };
