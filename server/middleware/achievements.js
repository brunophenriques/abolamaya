// Achievement definitions.
// Each has: type, name, icon, description, hidden?, check(db, userId)→bool
// The `check` function must be idempotent and safe to call frequently.
// `67_machine` is event-driven (awarded via awardAchievement) — check always returns false.

function getRank(db, uid) {
  const { total } = db.prepare(`
    SELECT
      COALESCE((SELECT SUM(points_earned) FROM match_predictions WHERE user_id=? AND points_earned IS NOT NULL),0) +
      COALESCE((SELECT SUM(points_earned) FROM group_points WHERE user_id=?),0) AS total
  `).get(uid, uid);

  const { rank } = db.prepare(`
    SELECT COUNT(*)+1 AS rank FROM (
      SELECT u.id,
        COALESCE((SELECT SUM(points_earned) FROM match_predictions WHERE user_id=u.id AND points_earned IS NOT NULL),0) +
        COALESCE((SELECT SUM(points_earned) FROM group_points WHERE user_id=u.id),0) AS total
      FROM users u WHERE (u.banned IS NULL OR u.banned=0)
    ) WHERE total > ?
  `).get(total);

  return rank;
}

const ACHIEVEMENTS = [
  // ── Existing (keep for backward compat) ─────────────────────────────────────
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
    check: (db, uid) => db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE user_id=? AND points_earned>=1').get(uid).n >= 10,
  },
  {
    type: 'twenty_correct',
    name: '20 Certas',
    icon: '⚡',
    description: 'Acertaste em 20 resultados.',
    check: (db, uid) => db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE user_id=? AND points_earned>=1').get(uid).n >= 20,
  },
  {
    type: 'high_accuracy',
    name: 'Sniper',
    icon: '🎯',
    description: 'Mais de 70% de precisão com pelo menos 10 previsões.',
    check: (db, uid) => {
      const r = db.prepare(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN points_earned>=1 THEN 1 ELSE 0 END) AS correct
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
    check: (db, uid) => db.prepare('SELECT 1 FROM group_points WHERE user_id=? AND points_earned=4 LIMIT 1').get(uid),
  },
  {
    type: 'five_streak',
    name: 'Em Chama',
    icon: '🔥',
    description: '5 previsões corretas consecutivas.',
    check: (db, uid) => {
      const preds = db.prepare(`
        SELECT mp.points_earned FROM match_predictions mp
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
    check: (db, uid) => db.prepare(
      "SELECT 1 FROM friends WHERE (requester_id=? OR addressee_id=?) AND status='accepted' LIMIT 1"
    ).get(uid, uid),
  },
  {
    type: 'all_predictions',
    name: 'Completo',
    icon: '📋',
    description: 'Fizeste previsões para todos os 72 jogos.',
    check: (db, uid) => db.prepare('SELECT COUNT(*) AS n FROM match_predictions WHERE user_id=?').get(uid).n >= 72,
  },

  // ── New achievements ─────────────────────────────────────────────────────────
  {
    type: 'primeiro_sangue',
    name: 'Primeiro Sangue',
    icon: '🩸',
    description: 'Fizeste a tua primeira previsão.',
    check: (db, uid) => db.prepare('SELECT 1 FROM match_predictions WHERE user_id=? LIMIT 1').get(uid),
  },
  {
    type: 'oraculo',
    name: 'Oráculo',
    icon: '🔮',
    description: 'Acertaste as 4 posições de um grupo.',
    check: (db, uid) => db.prepare('SELECT 1 FROM group_points WHERE user_id=? AND points_earned=4 LIMIT 1').get(uid),
  },
  {
    type: 'acreditar',
    name: 'Acreditar Até ao Fim',
    icon: '🇵🇹',
    description: 'Colocaste Portugal em 1.º lugar do grupo na tua previsão.',
    check: (db, uid) => {
      const gp = db.prepare("SELECT predicted_order FROM group_points WHERE user_id=? AND group_id='K'").get(uid);
      if (!gp) return false;
      try { return JSON.parse(gp.predicted_order)[0] === 'Portugal'; } catch { return false; }
    },
  },
  {
    type: 'anti_maya',
    name: 'Anti-Maya',
    icon: '☠️',
    description: 'Falhaste completamente um grupo (0/4).',
    check: (db, uid) => !!db.prepare(
      "SELECT 1 FROM group_points WHERE user_id=? AND points_earned=0 AND actual_order IS NOT NULL LIMIT 1"
    ).get(uid),
  },
  {
    type: 'primeiro_amigo',
    name: 'Primeiro Amigo',
    icon: '👋',
    description: 'Adicionaste o teu primeiro amigo.',
    check: (db, uid) => !!db.prepare(
      "SELECT 1 FROM friends WHERE (requester_id=? OR addressee_id=?) AND status='accepted' LIMIT 1"
    ).get(uid, uid),
  },
  {
    type: 'social',
    name: 'Social',
    icon: '🫂',
    description: 'Tens 10 amigos na plataforma.',
    check: (db, uid) => db.prepare(
      "SELECT COUNT(*) AS n FROM friends WHERE (requester_id=? OR addressee_id=?) AND status='accepted'"
    ).get(uid, uid).n >= 10,
  },
  {
    type: 'fundador',
    name: 'Fundador',
    icon: '🏠',
    description: 'Criaste a tua primeira sala.',
    check: (db, uid) => !!db.prepare('SELECT 1 FROM lobbies WHERE created_by=? LIMIT 1').get(uid),
  },
  {
    type: 'comunidade',
    name: 'Comunidade',
    icon: '🎉',
    description: 'A tua sala tem 10 ou mais membros.',
    check: (db, uid) => {
      const lobbies = db.prepare('SELECT id FROM lobbies WHERE created_by=?').all(uid);
      for (const l of lobbies) {
        if (db.prepare('SELECT COUNT(*) AS n FROM lobby_members WHERE lobby_id=?').get(l.id).n >= 10) return true;
      }
      return false;
    },
  },
  {
    type: 'top_100',
    name: 'Top 100',
    icon: '🌍',
    description: 'Entraste nos 100 primeiros na classificação global.',
    check: (db, uid) => getRank(db, uid) <= 100,
  },
  {
    type: 'top_25',
    name: 'Top 25',
    icon: '🥈',
    description: 'Entraste no Top 25 global.',
    check: (db, uid) => getRank(db, uid) <= 25,
  },
  {
    type: 'top_10',
    name: 'Top 10',
    icon: '🥇',
    description: 'Entraste na elite dos previsores.',
    check: (db, uid) => getRank(db, uid) <= 10,
  },
  {
    type: 'rei_da_colina',
    name: 'Rei da Colina',
    icon: '👑',
    description: 'Atingiste o 1.º lugar global.',
    check: (db, uid) => getRank(db, uid) === 1,
  },
  {
    type: 'nostradamus',
    name: 'Nostradamus',
    icon: '🎯',
    description: 'Acertaste um marcador exato.',
    check: (db, uid) => !!db.prepare(
      'SELECT 1 FROM match_predictions WHERE user_id=? AND points_earned=3 LIMIT 1'
    ).get(uid),
  },
  {
    type: '67_machine',
    name: '67 Machine',
    icon: '🤖',
    description: 'Encontraste uma lenda da comunidade.',
    hidden: true,
    check: () => false, // event-driven only — awarded via awardAchievement()
  },
];

// ── Core functions ────────────────────────────────────────────────────────────

function _notifyAchievement(db, userId, ach) {
  try {
    const { createNotification } = require('../routes/notifications');
    const u = db.prepare('SELECT username FROM users WHERE id=?').get(userId);
    createNotification(userId, {
      type:  'achievement',
      title: `${ach.icon} Achievement desbloqueado: ${ach.name}`,
      body:  ach.description,
      link:  u ? `/profile?u=${u.username}` : null,
    });
  } catch { /* notifications optional */ }
}

// Check all pollable achievements for a user and award any newly earned ones.
// Returns array of newly awarded achievement objects.
function checkAchievements(db, userId) {
  const earned = new Set(
    db.prepare('SELECT type FROM user_achievements WHERE user_id=?').all(userId).map(r => r.type)
  );
  const insert = db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, type) VALUES (?,?)');
  const newlyEarned = [];

  for (const ach of ACHIEVEMENTS) {
    if (earned.has(ach.type)) continue;
    if (ach.hidden) continue; // event-driven, skip polling
    try {
      if (ach.check(db, userId)) {
        insert.run(userId, ach.type);
        newlyEarned.push(ach);
        _notifyAchievement(db, userId, ach);
      }
    } catch { /* ignore individual check errors */ }
  }

  return newlyEarned;
}

// Directly award a specific achievement (for event-driven ones like 67_machine).
function awardAchievement(db, userId, type) {
  const ach = ACHIEVEMENTS.find(a => a.type === type);
  if (!ach) return false;
  const result = db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, type) VALUES (?,?)').run(userId, type);
  if (result.changes > 0) {
    _notifyAchievement(db, userId, ach);
    return true;
  }
  return false;
}

// Get all earned achievements for a user with full metadata.
function getUserAchievements(db, userId) {
  const earned = db.prepare(
    'SELECT type, earned_at FROM user_achievements WHERE user_id=? ORDER BY earned_at'
  ).all(userId);
  const meta = Object.fromEntries(ACHIEVEMENTS.map(a => [a.type, a]));
  return earned.map(e => ({ ...meta[e.type], earned_at: e.earned_at })).filter(a => a && a.name);
}

module.exports = { ACHIEVEMENTS, checkAchievements, awardAchievement, getUserAchievements };
