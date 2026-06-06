const cron                   = require('node-cron');
const { scrapeAllTeams }     = require('./soccerway');
const { autoSettleFromScrape } = require('../settle');
const TEAMS                  = require('./teams');
const { logEvent }           = require('../logs');

// ── Scrape lock ───────────────────────────────────────────────────────────────
let running = false;

async function runScrape(db, teams = TEAMS, label = 'scheduled') {
  if (running) {
    console.log(`[scheduler] ${label}: skipped (scrape already in progress)`);
    return;
  }
  running = true;
  const t0 = Date.now();
  console.log(`[scheduler] ${label}: starting (${teams.length} teams)…`);
  try {
    const { scraped, failed } = await scrapeAllTeams(db, teams);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[scheduler] ${label}: done in ${secs}s — ${scraped} OK, ${failed.length} failed`);
    if (failed.length) {
      console.warn('[scheduler] Failed teams:', failed.map(f => `${f.team} (${f.error})`).join('; '));
      logEvent({
        category: 'scraper',
        severity: 'warning',
        message:  `Scrape (${label}) concluído em ${secs}s — ${scraped} OK, ${failed.length} falhou: ${failed.map(f => f.team).join(', ')}`,
        metadata: { label, scraped, failed_count: failed.length, failed_teams: failed.map(f => ({ team: f.team, error: f.error })) },
      });
    } else {
      logEvent({
        category: 'scraper',
        message:  `Scrape (${label}) concluído em ${secs}s — ${scraped} seleções atualizadas`,
        metadata: { label, scraped, duration_s: parseFloat(secs) },
      });
    }

    // After each scrape, settle any WC matches whose results are now in team_results
    const { settled, skipped } = autoSettleFromScrape(db);
    if (settled) {
      console.log(`[scheduler] ${label}: auto-settled ${settled} match(es)`);
      logEvent({
        category: 'settle',
        message:  `Auto-settle após scrape (${label}): ${settled} jogo(s) liquidado(s), ${skipped} ignorado(s)`,
        metadata: { label, settled, skipped },
      });
    }
  } catch (err) {
    console.error(`[scheduler] ${label}: unexpected error — ${err.message}`);
    logEvent({
      category: 'scraper',
      severity: 'error',
      message:  `Erro inesperado no scrape (${label}): ${err.message}`,
      metadata: { label, error: err.message },
    });
  } finally {
    running = false;
  }
}

// ── Stale check ───────────────────────────────────────────────────────────────
// Cache is considered fresh if ≥ 90 % of teams have data scraped in the last 12 h.
function isCacheStale(db) {
  const { cnt } = db.prepare(`
    SELECT COUNT(DISTINCT team_code) AS cnt
    FROM   team_results
    WHERE  scraped_at > datetime('now', '-12 hours')
  `).get();
  return cnt < Math.ceil(TEAMS.length * 0.9);
}

// ── Matchday helper ───────────────────────────────────────────────────────────
function teamsWithRecentMatches(db) {
  const now    = new Date();
  const today  = now.toISOString().slice(0, 10);
  const utcNow = now.getUTCHours() + now.getUTCMinutes() / 60;

  const todayMatches = db.prepare(
    `SELECT home_team, away_team, match_time FROM matches WHERE match_date = ?`
  ).all(today);

  if (!todayMatches.length) return null;

  const teamNames = new Set();
  for (const m of todayMatches) {
    const [h, min] = m.match_time.split(':').map(Number);
    const kickoffUtc = ((h - 1 + 24) % 24) + min / 60;
    let hoursAgo = utcNow - kickoffUtc;
    if (hoursAgo < 0) hoursAgo += 24;
    if (hoursAgo >= 3 && hoursAgo <= 7) {
      teamNames.add(m.home_team);
      teamNames.add(m.away_team);
    }
  }

  if (!teamNames.size) return null;

  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return TEAMS.filter(t =>
    [...teamNames].some(dbName => {
      const a = norm(dbName), b = norm(t.name);
      return a === b || a.includes(b) || b.includes(a) ||
        (t.aliases || []).some(al => norm(al) === a);
    })
  );
}

// ── Scheduler setup ───────────────────────────────────────────────────────────
function startScheduler(db) {
  // ── 1. Full scrape twice a day (06:00 and 18:00 UTC) ─────────────────────
  cron.schedule('0 6,18 * * *', () => runScrape(db, TEAMS, '12h full'), { timezone: 'UTC' });

  // ── 2. Matchday extra: every hour 00:00–10:00 UTC ────────────────────────
  cron.schedule('0 0-10 * * *', () => {
    const teams = teamsWithRecentMatches(db);
    if (teams && teams.length > 0) {
      runScrape(db, teams, `matchday extra (${teams.map(t => t.code).join(',')})`);
    }
  }, { timezone: 'UTC' });

  console.log('[scheduler] Started — full scrape at 06:00 + 18:00 UTC, matchday checks 00:00–10:00 UTC');

  // ── 3. Startup scrape — skipped if SKIP_STARTUP_SCRAPE=true (set on Railway)
  if (process.env.SKIP_STARTUP_SCRAPE === 'true') {
    console.log('[scheduler] startup: scrape disabled via SKIP_STARTUP_SCRAPE');
  } else {
    setTimeout(() => {
      if (isCacheStale(db)) {
        runScrape(db, TEAMS, 'startup');
      } else {
        console.log('[scheduler] startup: cache fresh — scrape skipped');
      }
    }, 5000);
  }
}

module.exports = { startScheduler, runScrape };
