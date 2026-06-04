const express           = require('express');
const router            = express.Router();
const db                = require('../db');
const { auth }          = require('../middleware/auth');
const TEAMS             = require('../scraper/teams');
const { runScrape }     = require('../scraper/scheduler');

// GET /api/national-teams/scrape-status  (admin only)
// Returns per-team scrape stats so the admin UI can show coverage and freshness.
router.get('/scrape-status', auth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Acesso negado.' });

  const perTeam = db.prepare(`
    SELECT team_code, COUNT(*) AS result_count, MAX(scraped_at) AS last_scraped
    FROM   team_results
    GROUP  BY team_code
  `).all();

  const byCode = {};
  for (const r of perTeam) byCode[r.team_code] = r;

  const teams = TEAMS.map(t => ({
    code:         t.code,
    name:         t.name,
    slug:         t.slug,
    result_count: byCode[t.code]?.result_count ?? 0,
    last_scraped: byCode[t.code]?.last_scraped  ?? null,
  }));

  const scraped_count    = teams.filter(t => t.result_count > 0).length;
  const allDates         = teams.map(t => t.last_scraped).filter(Boolean);
  const last_full_scrape = allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : null;

  res.json({ teams, scraped_count, total: TEAMS.length, last_full_scrape });
});

// GET /api/national-teams/:slug/results
// Returns the last 5 scraped results for a team.
router.get('/:slug/results', auth, (req, res) => {
  const team = TEAMS.find(t => t.slug === req.params.slug);
  if (!team) return res.status(404).json({ error: 'Seleção não encontrada.' });

  const results = db.prepare(`
    SELECT match_date, competition, home_team, away_team,
           home_score, away_score, result_for_team, team_is_home, scraped_at
    FROM   team_results
    WHERE  team_code = ?
    ORDER  BY match_date DESC
    LIMIT  5
  `).all(team.code);

  res.json({
    team: { slug: team.slug, name: team.name, code: team.code },
    results,
    cached: results.length > 0
      ? results[0].scraped_at        // ISO string of the most recent scrape
      : null,
  });
});

// POST /api/national-teams/scrape  (admin only)
// Manually trigger a full scrape — useful for testing or after URL corrections.
router.post('/scrape', auth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Acesso negado.' });

  // Fire-and-forget so the HTTP response returns immediately
  setImmediate(() => runScrape(db, TEAMS, 'manual admin trigger'));

  res.json({ message: 'Scrape iniciado em background. Consulta os logs do servidor.' });
});

// POST /api/national-teams/:slug/scrape  (admin only)
// Scrape a single team — handy when correcting a Soccerway URL.
router.post('/:slug/scrape', auth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Acesso negado.' });

  const team = TEAMS.find(t => t.slug === req.params.slug);
  if (!team) return res.status(404).json({ error: 'Seleção não encontrada.' });

  setImmediate(() => runScrape(db, [team], `manual: ${team.name}`));

  res.json({ message: `Scrape de "${team.name}" iniciado em background.` });
});

module.exports = router;
