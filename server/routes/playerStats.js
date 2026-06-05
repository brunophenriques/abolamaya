const router = require('express').Router();
const db     = require('../db');
const { auth } = require('../middleware/auth');


// GET /api/player-stats/:slug — read cached player stats (all authenticated users)
router.get('/:slug', auth, (req, res) => {
  const rows = db.prepare(`
    SELECT player_name, player_url,
           soccerway_player_id, shirt_number,
           appearances, minutes, goals, assists,
           yellow_cards, red_cards, saves_pct, clean_sheets,
           senior_stats, scraped_at
    FROM player_national_stats
    WHERE team_slug = ?
    ORDER BY shirt_number, player_name
  `).all(req.params.slug);

  // Deserialize senior_stats JSON so the client gets a plain object
  const players = rows.map(p => ({
    ...p,
    senior_stats: p.senior_stats ? (() => { try { return JSON.parse(p.senior_stats); } catch { return null; } })() : null,
  }));

  const lastScraped = players.length
    ? players.reduce((a, b) => a.scraped_at > b.scraped_at ? a : b).scraped_at
    : null;

  res.json({ players, last_scraped: lastScraped, count: players.length });
});

// GET /api/player-stats/:slug/status — admin quick status
router.get('/:slug/status', auth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MAX(scraped_at) AS last_scraped
    FROM player_national_stats
    WHERE team_slug = ?
  `).get(req.params.slug);
  res.json(row || { count: 0, last_scraped: null });
});

// POST /api/player-stats/:slug/scrape — admin only, fire-and-forget
// Query: ?test=1  → only scrapes first 3 players
router.post('/:slug/scrape', auth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });

  const teams = require('../scraper/teams');
  const team  = teams.find(t => t.slug === req.params.slug);
  if (!team) return res.status(404).json({ error: 'Team not found' });

  const testMode = req.query.test === '1' || req.query.test === 'true';
  const limit    = testMode ? 3 : null;

  res.json({
    ok:      true,
    message: `Scrape de "${team.name}" iniciado${testMode ? ' (teste: 3 jogadores)' : ''}. Vê os logs para detalhes.`,
    team:    team.name,
  });

  setImmediate(async () => {
    try {
      const { scrapeTeamPlayerNationalStats } = require('../scraper/playerStatsSoccerway');
      const result = await scrapeTeamPlayerNationalStats(db, team, { limit });
      console.log('[playerStats] Scrape completo:', JSON.stringify(result));
    } catch (err) {
      console.error('[playerStats] Scrape falhou:', err.message);
    }
  });
});

// POST /api/player-stats/scrape-all — scrape all 48 teams sequentially (admin only)
router.post('/scrape-all', auth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });

  const teams    = require('../scraper/teams');
  const testMode = req.query.test === '1';
  const limit    = testMode ? 2 : null;

  res.json({
    ok:      true,
    message: `Scrape de jogadores iniciado para ${teams.length} seleções${testMode ? ' (teste: 2 por equipa)' : ''}. Pode demorar várias horas. Vê os logs.`,
    teams:   teams.length,
  });

  setImmediate(async () => {
    const { scrapeTeamPlayerNationalStats } = require('../scraper/playerStatsSoccerway');
    let done = 0, failed = 0;
    for (const team of teams) {
      try {
        console.log(`[scrapeAll] (${done + 1}/${teams.length}) ${team.name}`);
        await scrapeTeamPlayerNationalStats(db, team, { limit });
        done++;
      } catch (err) {
        console.error(`[scrapeAll] FAILED ${team.name}: ${err.message}`);
        failed++;
      }
    }
    console.log(`[scrapeAll] Concluído — ${done} OK, ${failed} falharam`);
  });
});

module.exports = router;
