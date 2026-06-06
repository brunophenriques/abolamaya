const { chromium } = require('playwright');

const DELAY_MS       = 3000;  // delay between team requests (ms)
const NAV_TIMEOUT_MS = 30000; // page load timeout
const RESULTS_LIMIT  = 5;     // last N matches to keep

// ── Helpers ──────────────────────────────────────────────────────────────────

function normName(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function teamMatches(scrapedName, team) {
  const a = normName(scrapedName);
  const allNames = [team.name, ...(team.aliases || [])].map(normName);
  return allNames.some(b => a === b || a.includes(b) || b.includes(a));
}

const MONTHS = {
  Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
  Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
};

// Handles "DD/MM/YY", "DD/MM/YYYY", "Apr 01", "Nov 16, 2025"
function parseSoccerwayDate(raw) {
  if (!raw) return null;
  const s = raw.trim();

  // Legacy format: DD/MM/YY or DD/MM/YYYY
  const old = s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (old) {
    const [, d, mo, y] = old;
    const year = y.length === 4 ? parseInt(y) : (parseInt(y) < 50 ? 2000 + parseInt(y) : 1900 + parseInt(y));
    return `${year}-${mo}-${d}`;
  }

  // New format: "Apr 01" or "Nov 16, 2025"
  const neo = s.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:,\s*(\d{4}))?$/);
  if (neo) {
    const [, mon, day, yearStr] = neo;
    const mo = MONTHS[mon];
    const d  = day.padStart(2, '0');
    const yr = yearStr ? parseInt(yearStr) : (() => {
      // Infer year: if month is ahead of today, it was last year
      const now = new Date();
      return parseInt(mo) > (now.getMonth() + 1) ? now.getFullYear() - 1 : now.getFullYear();
    })();
    return `${yr}-${mo}-${d}`;
  }

  return null;
}

// ── Cookie consent ────────────────────────────────────────────────────────────

async function dismissConsent(page) {
  const selectors = [
    '#didomi-notice-agree-button',
    'button.didomi-btn-primary',
    '[aria-label="Accept all"]',
    'button:has-text("Accept all")',
    'button:has-text("I Accept")',
    '.cookieConsentOK',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await page.waitForTimeout(600);
        return;
      }
    } catch { /* not present */ }
  }
}

// ── URL builder ──────────────────────────────────────────────────────────────

function getSoccerwayUrl(team) {
  if (team.resultsUrl) return team.resultsUrl;
  const slug = team.soccerwaySlug || team.slug;
  return `https://us.soccerway.com/team/${slug}/${team.soccerwayKey}/`;
}

// ── Body text parser (state machine) ─────────────────────────────────────────
//
// Handles the card format emitted by Soccerway's /results/ page, e.g.:
//
//   Friendly International
//   WORLD:
//   Apr 01
//   12:00 AM
//   USA
//   Portugal
//   0
//   2
//   W
//   Mar 29
//   02:00 AM
//   Mexico
//   Portugal
//   0
//   0
//   T
//   World Championship - Qualification
//   EUROPE:
//   Nov 16, 2025
//   Portugal
//   Armenia
//   9
//   1
//   W
//
// Penalty shootout: score lines may be followed by a (N) penalty line; ignored.

function parseBodyText(text, allNames, limit) {
  function norm(s) {
    return (s || '').toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
  function nameMatches(s, names) {
    const a = norm(s);
    return names.some(b => a === b || a.includes(b) || b.includes(a));
  }

  const results   = [];
  const lines     = text.split('\n').map(l => l.trim()).filter(Boolean);

  const isDate    = l => /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:,\s*\d{4})?$/.test(l);
  const isTime    = l => /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(l);
  const isStatus  = l => /^(AET|After\s+SO|Pen\.|Agg\.)$/i.test(l);
  const isScore   = l => /^\d+$/.test(l);
  const isPenalty = l => /^\(\d+\)$/.test(l);
  const isResult  = l => /^[WLT]$/i.test(l);
  const isRegion  = l => /^[A-Z][A-Z\s]*:$/.test(l);  // "WORLD:", "SOUTH AMERICA:", ...
  const COMP_KW   = /\b(International|Championship|Cup|League|Nations|World|Qualifier|Qualification|UEFA|FIFA|CONMEBOL|CONCACAF|CAF|AFC|OFC|Friendly|Elimination|Play.?[Oo]ff)\b/;

  let competition = '';
  let i = 0;

  // States: LOOKING → DATE_FOUND → HAVE_HOME → HAVE_AWAY → HAVE_HOME_SCORE → HAVE_AWAY_SCORE
  // Any unexpected line in a match sub-state resets to LOOKING.

  while (i < lines.length && results.length < limit) {
    const l = lines[i];

    // ── LOOKING ──────────────────────────────────────────────────────────────
    if (COMP_KW.test(l) && !isDate(l) && !isScore(l) && !isResult(l)) {
      competition = l; i++; continue;
    }
    if (isRegion(l)) { i++; continue; }
    if (!isDate(l))  { i++; continue; }

    // ── DATE_FOUND ───────────────────────────────────────────────────────────
    const dateText = l; i++;
    if (i < lines.length && isTime(lines[i]))   i++;          // skip time
    while (i < lines.length && isStatus(lines[i])) i++;       // skip AET / After SO

    // ── HAVE_HOME → home team name ────────────────────────────────────────
    if (i >= lines.length || isDate(lines[i]) || isScore(lines[i]) || isResult(lines[i])) continue;
    const homeName = lines[i++];

    // ── HAVE_AWAY → away team name ────────────────────────────────────────
    if (i >= lines.length || isDate(lines[i]) || isScore(lines[i]) || isResult(lines[i])) continue;
    const awayName = lines[i++];

    // ── HAVE_HOME_SCORE ───────────────────────────────────────────────────
    if (i >= lines.length || !isScore(lines[i])) continue;
    const homeScore = parseInt(lines[i++]);
    if (i < lines.length && isPenalty(lines[i])) i++;         // skip (N) penalty

    // ── HAVE_AWAY_SCORE ───────────────────────────────────────────────────
    if (i >= lines.length || !isScore(lines[i])) continue;
    const awayScore = parseInt(lines[i++]);
    if (i < lines.length && isPenalty(lines[i])) i++;         // skip (N) penalty

    // ── RESULT ────────────────────────────────────────────────────────────
    if (i >= lines.length || !isResult(lines[i])) continue;
    const rc     = lines[i++].toUpperCase();
    const result = rc === 'T' ? 'D' : rc;                     // Soccerway uses T for Draw

    // Only keep if our team is home or away
    const isHome = nameMatches(homeName, allNames);
    const isAway = nameMatches(awayName, allNames);
    if (!isHome && !isAway) continue;

    results.push({ dateText, competition, homeName, awayName, homeScore, awayScore, result, isHome });
  }

  return results;
}

// ── Navigation with one retry ─────────────────────────────────────────────────

async function gotoWithRetry(page, url, teamName) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (firstErr) {
    console.warn(`[scraper] ${teamName}: goto timed out (${firstErr.message.split('\n')[0]}) — retrying…`);
    // Reset page state before retry
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Second attempt — throws if it fails again (caught by scrapeAllTeams)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
}

// ── Core scraper ─────────────────────────────────────────────────────────────

async function scrapeTeam(team, page) {
  const baseUrl    = getSoccerwayUrl(team);
  const resultsUrl = `${baseUrl}results/`;

  console.log('[scraper]', team.name, 'URL:', resultsUrl);
  await gotoWithRetry(page, resultsUrl, team.name);
  await dismissConsent(page);
  await page.waitForTimeout(3000);

  console.log('[scraper]', team.name, 'final URL:', page.url());
  console.log('[scraper]', team.name, 'title:', await page.title());

  // If /results/ redirected to the summary page, click the Results tab
  if (!page.url().includes('/results')) {
    try {
      const tab = page.locator('a:has-text("Results"), a[href*="/results/"]').first();
      if (await tab.isVisible({ timeout: 3000 })) {
        await tab.click();
        await page.waitForTimeout(3000);
        console.log('[scraper]', team.name, 'after Results tab, URL:', page.url());
      }
    } catch { /* tab not found */ }
  }

  const allNames = [team.name, ...(team.aliases || [])].map(normName);

  // ── Extract via a.eventRowLink (DOM) + body text ──────────────────────────
  //
  // Primary parsing is done on body text (handles competition section headers).
  // The DOM pass extracts match IDs and per-container text as a secondary source.

  const { matchRows, bodyText } = await page.evaluate(() => {
    const COMP_KW = /\b(International|Championship|Cup|League|Nations|World|Qualifier|Qualification|UEFA|FIFA|CONMEBOL|CONCACAF|CAF|AFC|OFC|Friendly|Elimination|Play.?[Oo]ff)\b/;

    // Walk up the DOM to find the nearest preceding element containing a
    // competition keyword — used to associate a match row with its section header.
    function findCompetition(startEl) {
      let current = startEl;
      for (let level = 0; level < 4; level++) {
        if (!current || current === document.body) break;
        let sib = current.previousElementSibling;
        for (let d = 0; d < 12; d++) {
          if (!sib) break;
          const t = (sib.innerText || '').trim();
          const firstLine = t.split('\n')[0].trim();
          if (firstLine && COMP_KW.test(firstLine) && firstLine.length < 100) return firstLine;
          sib = sib.previousElementSibling;
          d++;
        }
        current = current.parentElement;
      }
      return '';
    }

    const anchors   = [...document.querySelectorAll('a.eventRowLink')];
    const matchRows = [];

    for (const anchor of anchors) {
      // Extract match ID: prefer ?mid= param, fall back to id attr suffix
      const href = anchor.getAttribute('href') || '';
      const midM = href.match(/[?&]mid=([A-Za-z0-9]+)/);
      const matchId = midM
        ? midM[1]
        : anchor.id.replace(/^match-row-g_\d+_/, '');

      // Walk up until we find a container with enough content lines
      let container = anchor.parentElement;
      for (let d = 0; d < 5; d++) {
        if (!container || container === document.body) break;
        const lineCount = (container.innerText || '').trim().split('\n')
          .filter(l => l.trim()).length;
        if (lineCount >= 6) break;
        container = container.parentElement;
      }
      if (!container || container === document.body) continue;

      const competition   = findCompetition(container);
      const containerText = (container.innerText || '').trim();
      matchRows.push({ matchId, href, competition, containerText });
    }

    return {
      matchRows,
      bodyText: (document.body.innerText || '').trim(),
    };
  });

  console.log('[scraper]', team.name, `eventRowLink anchors: ${matchRows.length}`);
  console.log('[scraper]', team.name, 'body text sample:\n', bodyText.slice(0, 1000));

  // ── Fail fast on error pages or empty results pages ───────────────────────
  if (bodyText.includes("The requested page can't be displayed")) {
    throw new Error('Soccerway returned an error page — URL may be wrong');
  }
  if (matchRows.length === 0) {
    throw new Error('No eventRowLink anchors found — URL may be wrong or page did not render');
  }

  // ── Primary: parse full body text (state machine, handles section headers) ─
  let rows = parseBodyText(bodyText, allNames, RESULTS_LIMIT);

  // ── Secondary: parse per-container texts from a.eventRowLink ──────────────
  if (rows.length === 0 && matchRows.length > 0) {
    for (const { competition, containerText } of matchRows) {
      if (rows.length >= RESULTS_LIMIT) break;
      // Inject competition as a header and reuse the body text parser
      const r = parseBodyText(`${competition}\n${containerText}`, allNames, 1);
      if (r.length) rows.push(r[0]);
    }
    if (rows.length) console.log('[scraper]', team.name, `container parser found ${rows.length} rows`);
  }

  // ── Tertiary: old HTML table format (pre-2024 Soccerway) ─────────────────
  if (rows.length === 0) {
    try {
      await page.waitForSelector(
        'table.matches, [data-match-id], .matches-table, .block-content table',
        { timeout: 4000 }
      );
      const tableRows = await page.evaluate((allNames, limit) => {
        function norm(s) {
          return (s || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]/g, '');
        }
        function matches(scraped, names) {
          const a = norm(scraped);
          return names.some(b => a === b || a.includes(b) || b.includes(a));
        }
        const out = [];
        const trs = document.querySelectorAll(
          'table.matches tr.odd, table.matches tr.even, ' +
          'table.matches tr[class="odd"], table.matches tr[class="even"]'
        );
        for (const tr of trs) {
          if (out.length >= limit) break;
          const scoreEl = tr.querySelector('.score-time a, td.score a, td[class*="score"] a');
          if (!scoreEl) continue;
          const sm = scoreEl.textContent.trim().match(/^(\d+)\s+-\s+(\d+)$/);
          if (!sm) continue;
          const homeScore = parseInt(sm[1]), awayScore = parseInt(sm[2]);
          const dayEl  = tr.querySelector('td.day a, td.date a, [class*="day"] a, td:first-child a');
          if (!dayEl) continue;
          const homeEl = tr.querySelector('td.team-a a, [class*="team-a"] a, td.home a');
          const awayEl = tr.querySelector('td.team-b a, [class*="team-b"] a, td.away a');
          if (!homeEl || !awayEl) continue;
          const homeName = (homeEl.querySelector('.team-name-long') || homeEl).textContent.trim();
          const awayName = (awayEl.querySelector('.team-name-long') || awayEl).textContent.trim();
          if (!homeName || !awayName) continue;
          const compImg   = tr.querySelector('td.competition img, [class*="competition"] img');
          const competition = compImg ? (compImg.getAttribute('title') || compImg.getAttribute('alt') || '') : '';
          const isHome    = matches(homeName, allNames);
          const isAway    = matches(awayName, allNames);
          if (!isHome && !isAway) continue;
          let result;
          if (homeScore === awayScore) result = 'D';
          else if (isHome) result = homeScore > awayScore ? 'W' : 'L';
          else             result = awayScore > homeScore ? 'W' : 'L';
          out.push({ dateText: dayEl.textContent.trim(), competition, homeName, awayName, homeScore, awayScore, result, isHome });
        }
        return out;
      }, allNames, RESULTS_LIMIT);
      rows = tableRows;
      if (rows.length) console.log('[scraper]', team.name, `HTML table parser found ${rows.length} rows`);
    } catch { /* no table */ }
  }

  const now = new Date().toISOString();
  return rows
    .map(r => {
      const match_date = parseSoccerwayDate(r.dateText);
      if (!match_date) return null;
      return {
        team_code:       team.code,
        team_name:       team.name,
        match_date,
        competition:     r.competition,
        home_team:       r.homeName,
        away_team:       r.awayName,
        home_score:      r.homeScore,
        away_score:      r.awayScore,
        result_for_team: r.result,
        team_is_home:    r.isHome !== undefined ? (r.isHome ? 1 : 0) : null,
        soccerway_url:   resultsUrl,
        scraped_at:      now,
      };
    })
    .filter(Boolean);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function scrapeAllTeams(db, teams) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'AppleWebKit/537.36 (KHTML, like Gecko)',
      'Chrome/124.0.0.0 Safari/537.36',
    ].join(' '),
    viewport: { width: 1280, height: 800 },
    locale:   'en-US',
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  const upsert = db.prepare(`
    INSERT INTO team_results
      (team_code, team_name, match_date, competition,
       home_team, away_team, home_score, away_score,
       result_for_team, team_is_home, soccerway_url, scraped_at)
    VALUES
      (@team_code, @team_name, @match_date, @competition,
       @home_team, @away_team, @home_score, @away_score,
       @result_for_team, @team_is_home, @soccerway_url, @scraped_at)
    ON CONFLICT(team_code, match_date, home_team, away_team) DO UPDATE SET
      home_score       = excluded.home_score,
      away_score       = excluded.away_score,
      result_for_team  = excluded.result_for_team,
      team_is_home     = excluded.team_is_home,
      competition      = excluded.competition,
      scraped_at       = excluded.scraped_at
  `);

  const failed = [];

  for (const team of teams) {
    try {
      console.log(`[scraper] ${team.name}…`);
      const results = await scrapeTeam(team, page);

      if (results.length === 0) {
        console.warn(`[scraper] ${team.name}: no results found`);
      } else {
        db.transaction(rows => rows.forEach(r => upsert.run(r)))(results);
        console.log(`[scraper] ${team.name}: ${results.length} results saved`);
      }
    } catch (err) {
      console.error(`[scraper] FAILED ${team.name}: ${err.message}`);
      failed.push({ team: team.name, error: err.message });
    }

    await page.waitForTimeout(DELAY_MS + Math.floor(Math.random() * 1000));
  }

  await browser.close();
  return { scraped: teams.length - failed.length, failed };
}

module.exports = { scrapeAllTeams, teamMatches, getSoccerwayUrl };
