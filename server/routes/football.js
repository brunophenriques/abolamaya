const express = require('express');
const router  = express.Router();
const { auth } = require('../middleware/auth');
const { API_FOOTBALL_KEY } = require('../config');

const API_BASE       = 'https://v3.football.api-sports.io';
const CACHE_TTL      = 6 * 60 * 60 * 1000; // 6 h  — historical results never change
const LIVE_CACHE_TTL = 60 * 1000;           // 60 s — live scores; 1 real call/min max
const cache          = new Map();

// Some squads use names that differ from API-Football's national team names
const TEAM_NAME_MAP = {
  'usa':                  'United States',
  'south korea':          'Korea Republic',
  'ivory coast':          "Côte d'Ivoire",
  'congo dr':             'DR Congo',
  'dr congo':             'DR Congo',
  'north macedonia':      'North Macedonia',
  'republic of ireland':  'Ireland',
  'czech republic':       'Czechia',
};

function resolveTeamName(raw) {
  return TEAM_NAME_MAP[raw.toLowerCase()] ?? raw;
}

// Goals-based result — more reliable than the winner boolean (which can be null)
function getTeamResult(fixture, teamId) {
  const gh = fixture.goals.home;
  const ga = fixture.goals.away;
  if (gh === null || ga === null) return null; // match not finished
  if (gh === ga) return 'D';
  const isHome = fixture.teams.home.id === teamId;
  return (isHome ? gh > ga : ga > gh) ? 'W' : 'L';
}

async function apiFetch(path) {
  if (!API_FOOTBALL_KEY) {
    const err = new Error('API_FOOTBALL_KEY não está configurado no servidor. Adiciona-o ao ficheiro .env.');
    err.status = 503;
    throw err;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'x-apisports-key': API_FOOTBALL_KEY },
  });
  if (res.status === 429) {
    const err = new Error('Limite de pedidos da API atingido. Tenta novamente mais tarde.');
    err.status = 429;
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Erro da API-Football: ${res.status}`);
    err.status = 502;
    throw err;
  }
  return res.json();
}

async function getCached(key, ttl, fetcher) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const data = await fetcher();
  cache.set(key, { data, exp: Date.now() + ttl });
  return data;
}

// GET /api/football/form?team=Argentina
// Returns last 5 results for a national team with W / D / L from that team's perspective.
// Requires login (auth) to prevent quota abuse.
router.get('/form', auth, async (req, res) => {
  const rawName = (req.query.team || '').trim();
  if (!rawName) return res.status(400).json({ error: 'Parâmetro "team" obrigatório.' });

  const teamName = resolveTeamName(rawName);
  const cacheKey = `form:${teamName.toLowerCase()}`;

  try {
    const form = await getCached(cacheKey, CACHE_TTL, async () => {
      // 1. Resolve team ID from API-Football
      const teamsData = await apiFetch(`/teams?name=${encodeURIComponent(teamName)}`);
      const national  = teamsData.response?.find(t => t.team?.national === true);
      if (!national) {
        const err = new Error(`Seleção não encontrada na API: "${teamName}"`);
        err.status = 404;
        throw err;
      }
      const teamId = national.team.id;

      // 2. Fetch last 5 completed fixtures
      const fixturesData = await apiFetch(`/fixtures?team=${teamId}&last=5`);
      return (fixturesData.response ?? [])
        .map(f => {
          const result = getTeamResult(f, teamId);
          if (!result) return null; // skip unfinished
          const isHome = f.teams.home.id === teamId;
          return {
            date:        f.fixture.date,
            opponent:    isHome ? f.teams.away.name : f.teams.home.name,
            score:       isHome
              ? `${f.goals.home}-${f.goals.away}`
              : `${f.goals.away}-${f.goals.home}`,
            result,
            competition: f.league?.name ?? '',
          };
        })
        .filter(Boolean);
    });

    res.json({ form });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/football/stats?team=Argentina&league=1&season=2026
// Team statistics for a given league/season (wins, losses, draws, goals, form string…)
// league defaults to 1 (FIFA World Cup), season defaults to current year.
router.get('/stats', auth, async (req, res) => {
  const rawName = (req.query.team || '').trim();
  if (!rawName) return res.status(400).json({ error: 'Parâmetro "team" obrigatório.' });

  const teamName = resolveTeamName(rawName);
  const league   = req.query.league  || '1';
  const season   = req.query.season  || new Date().getFullYear().toString();
  const cacheKey = `stats:${teamName.toLowerCase()}:${league}:${season}`;

  try {
    const stats = await getCached(cacheKey, CACHE_TTL, async () => {
      // Resolve team ID
      const teamsData = await apiFetch(`/teams?name=${encodeURIComponent(teamName)}`);
      const national  = teamsData.response?.find(t => t.team?.national === true);
      if (!national) {
        const err = new Error(`Seleção não encontrada na API: "${teamName}"`);
        err.status = 404;
        throw err;
      }
      const teamId = national.team.id;

      const data = await apiFetch(`/teams/statistics?league=${league}&team=${teamId}&season=${season}`);
      const s    = data.response;
      if (!s) {
        const err = new Error('Sem estatísticas disponíveis para esta seleção/liga/época.');
        err.status = 404;
        throw err;
      }
      return {
        team:    { id: s.team.id, name: s.team.name, logo: s.team.logo },
        league:  { id: s.league.id, name: s.league.name, season: s.league.season },
        fixtures: s.fixtures,   // played / wins / draws / losses (home, away, total)
        goals:    s.goals,      // for / against (total, average)
        form:     s.form,       // e.g. "WWDLW" — last N matches in this competition
        biggest:  s.biggest,    // biggest win/loss streaks, biggest scores
      };
    });

    res.json({ stats });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/football/live
// All currently live fixtures. Cache is 60 s to avoid burning the daily quota.
// Returns an empty array (not an error) when no matches are live.
router.get('/live', auth, async (req, res) => {
  try {
    const { fixtures, fetchedAt } = await getCached('live:all', LIVE_CACHE_TTL, async () => {
      const data = await apiFetch('/fixtures?live=all');
      return {
        fetchedAt: new Date().toISOString(),
        fixtures: (data.response ?? []).map(f => ({
          id:       f.fixture.id,
          status:   f.fixture.status.short,    // '1H' | 'HT' | '2H' | 'ET' | 'P' | 'FT'
          elapsed:  f.fixture.status.elapsed,  // minutes played, or null
          date:     f.fixture.date,
          league:   { id: f.league.id, name: f.league.name, country: f.league.country },
          home:     { name: f.teams.home.name, logo: f.teams.home.logo },
          away:     { name: f.teams.away.name, logo: f.teams.away.logo },
          goals:    { home: f.goals.home, away: f.goals.away },
          score:    f.score,
        })),
      };
    });

    res.json({ fixtures, fetchedAt });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
