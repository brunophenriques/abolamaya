const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── Debug flag ────────────────────────────────────────────────────────────────
const DEBUG = true;

const PLAYER_DELAY_MS = 1500;
const NAV_TIMEOUT_MS  = 30000;
const BASE_URL        = 'https://us.soccerway.com';
const DEBUG_DIR       = path.join(__dirname, '..', '..', 'debug-screenshots');

if (DEBUG && !fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function gotoWithRetry(page, url, label) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  } catch {
    console.warn(`[playerStats] ${label}: goto timed out — retrying…`);
    await page.goto('about:blank', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
  }
}

function toInt(v) {
  if (v === null || v === undefined) return null;
  const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? null : n;
}

// Map a column title string to our canonical DB key
function titleToKey(raw) {
  const s = (raw || '').toLowerCase().trim();

  // Appearances
  if (s.includes('games played') || s.includes('matches played') ||
      s === 'apps' || s === 'appearances' || s === 'mp' || s === 'gp') return 'appearances';

  // Minutes
  if (s.includes('minute')) return 'minutes';

  // Goals — MUST come before red_cards check.
  // "goals scored".includes('red') is TRUE because "sco-RED" contains "red".
  if (s === 'goals' || s.includes('goals scored') || s.includes('goals for') ||
      s === 'gls' || s === 'g') return 'goals';

  // Assists
  if (s === 'assists' || s === 'ast') return 'assists';

  // Goalkeeper stats
  if (s.includes('save percentage') || s === 'sv%' || s.includes('save%')) return 'saves_pct';
  if (s.includes('shutout') || s.includes('clean sheet') || s === 'cs')     return 'clean_sheets';

  // Cards — use precise checks, NOT s.includes('red') which would match "scored"
  if (s.includes('yellow'))                                      return 'yellow_cards';
  if (s === 'red cards' || s === 'red card' || s === 'red' ||
      s === 'rc' || s.startsWith('red card'))                    return 'red_cards';

  return null; // rating and other unknown columns → skip
}

// ── Body-text TOTAL row parser ────────────────────────────────────────────────
//
// Reads up to `maxCount` values after the TOTAL line in the body text.
// Uses the NATIONAL TEAM section as an anchor.
// When maxCount = 0 (DOM headers missing), defaults to 6 so values are still read.

// Labels that appear after the stat values in body text — stop collecting when seen
const TOTAL_STOP = /^(Injury|Transfer|Show more|NOTE|Advertisement|Career|See more|More stats)/i;

function parseTotalFromBodyText(text, maxCount) {
  const count = maxCount > 0 ? maxCount : 6; // never read 0 values
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  const ntIdx = lines.findIndex(l => /^national\s*team$/i.test(l));
  const searchFrom = ntIdx >= 0 ? ntIdx : 0;

  let totalIdx = -1;
  for (let i = searchFrom; i < lines.length; i++) {
    if (/^total$/i.test(lines[i])) { totalIdx = i; break; }
  }
  if (totalIdx === -1) return null;

  const values = [];
  for (let i = totalIdx + 1; i < lines.length && values.length < count; i++) {
    const v = lines[i];
    if (/^[A-Z]{4,}$/.test(v) && v !== 'TOTAL') break; // next section header
    if (TOTAL_STOP.test(v)) break;                      // trailing junk labels
    values.push(v === '-' ? null : v);
  }
  return values.length ? values : null;
}

// ── Positional stat mapping (fallback when DOM headers not available) ─────────
//
// Soccerway column order observed for Portugal NT:
//   GK:      Matches Played | Save % | Shutouts | Yellow Cards | Red Cards
//   Outfield: Matches Played | Goals  | Assists  | Yellow Cards | Red Cards
//
// We detect GK by checking if "SV%" or "Shutouts"/"CS" appears in the
// National Team body text section (those headers are visible text, not icons).

function mapStatsByPosition(values, bodyText) {
  const ntStart  = bodyText.search(/national\s*team/i);
  const section  = ntStart >= 0 ? bodyText.slice(ntStart, ntStart + 2000) : bodyText;
  const isGK     = /\bSV%\b|\bShutout|\bClean\s*Sheet|\bCS\b/i.test(section);

  console.log(`[playerStats]   positional fallback — isGK=${isGK}  values=[${values.join(', ')}]`);

  const result = {
    appearances: null, minutes: null, goals: null, assists: null,
    yellow_cards: null, red_cards: null, saves_pct: null, clean_sheets: null,
  };

  // Position 0 is always Matches Played for both layouts
  result.appearances = toInt(values[0] ?? null);

  if (isGK) {
    result.saves_pct    = values[1] ?? null; // often "-" → stored as null
    result.clean_sheets = toInt(values[2] ?? null);
    result.yellow_cards = toInt(values[3] ?? null);
    result.red_cards    = toInt(values[4] ?? null);
  } else {
    result.goals        = toInt(values[1] ?? null);
    result.assists      = toInt(values[2] ?? null);
    result.yellow_cards = toInt(values[3] ?? null);
    result.red_cards    = toInt(values[4] ?? null);
  }

  return result;
}

// ── Map DOM headers + values → result object ─────────────────────────────────

function buildResult(headers, values, bodyText) {
  const result = {
    appearances: null, minutes: null, goals: null, assists: null,
    yellow_cards: null, red_cards: null, saves_pct: null, clean_sheets: null,
  };

  if (headers.length > 0) {
    // Rating appears in the header row but has NO corresponding cell in the TOTAL row.
    // Removing it realigns the remaining headers with the actual value positions.
    const statHeaders = headers.filter(h => (h || '').toLowerCase().trim() !== 'rating');

    console.log(`[playerStats]   buildResult headers=[${statHeaders.join(' | ')}] values=[${values.join(' | ')}]`);

    statHeaders.forEach((header, idx) => {
      const key = titleToKey(header);
      const v   = idx < values.length ? values[idx] : undefined;
      console.log(`[playerStats]     "${header}" (key=${key ?? 'skip'}) => ${v === null ? 'null' : v}`);
      if (!key || !(key in result) || idx >= values.length) return;
      if (v === null) return;
      result[key] = key === 'saves_pct' ? v : toInt(v);
    });
    return result;
  }

  // No DOM headers — use positional fallback
  if (values.length > 0) {
    return mapStatsByPosition(values, bodyText || '');
  }

  console.log(`[playerStats]   WARNING: no headers and no values — all null`);
  return result;
}

// ── Squad page ────────────────────────────────────────────────────────────────

async function scrapeSquadPlayerLinks(page, team) {
  const squadUrl = `${BASE_URL}/team/${team.soccerwaySlug || team.slug}/${team.soccerwayKey}/squad/`;
  console.log(`[playerStats] ${team.name}: squad URL = ${squadUrl}`);

  await gotoWithRetry(page, squadUrl, team.name);
  await dismissConsent(page);
  await page.waitForTimeout(2000);

  const playerLinks = await page.evaluate((base) => {
    // Extract the opaque player hash from the URL, e.g. "hC31Ab0c" from /player/diogo-costa/hC31Ab0c/
    function playerKey(href) {
      const parts = href.replace(/\/$/, '').split('/').filter(Boolean);
      if (parts.length < 3 || parts[0] !== 'player') return null;
      return parts[parts.length - 1];
    }

    function extractShirtNumber(anchor) {
      // Walk up to the row element and look for the shirt number cell
      const row = anchor.closest('tr') ||
                  anchor.closest('[class*="lineupTable__row"]') ||
                  anchor.closest('[class*="lineupRow"]');
      if (!row) return null;
      const shirtCandidates = [
        '[class*="lineupTable__cell--shirt"]',
        '[class*="lineupTable__cell--number"]',
        '[class*="shirt"]',
        '[class*="number"]',
        'td:first-child',
      ];
      for (const sel of shirtCandidates) {
        const el = row.querySelector(sel);
        if (!el) continue;
        const n = parseInt(el.textContent.trim(), 10);
        if (!isNaN(n) && n >= 1 && n <= 99) return n;
      }
      return null;
    }

    const seen  = new Set();
    const links = [];

    // Primary: a.lineupTable__cell--name (current Soccerway React UI)
    const cells = document.querySelectorAll('a.lineupTable__cell--name');
    for (const a of cells) {
      const href     = (a.getAttribute('href') || '').replace(/\/$/, '') + '/';
      const key      = playerKey(href);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const name     = a.textContent.trim();
      if (!name) continue;
      const shirtNum = extractShirtNumber(a);
      links.push({ name, url: base + href, playerId: key, shirtNumber: shirtNum });
    }

    if (links.length) return links;

    // Fallback: any /player/ link on the page
    for (const a of document.querySelectorAll('a[href^="/player/"]')) {
      const href = (a.getAttribute('href') || '').replace(/\/$/, '') + '/';
      const key  = playerKey(href);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const name = a.textContent.trim();
      if (name) links.push({ name, url: base + href, playerId: key, shirtNumber: null });
    }
    return links;
  }, BASE_URL);

  console.log(`[playerStats] ${team.name}: ${playerLinks.length} raw links (deduped)`);

  // Players have a shirt number; managers/staff do not.
  // Filter to shirt-numbered entries to exclude manager profile links.
  const withNumber    = playerLinks.filter(p => p.shirtNumber !== null);
  const squadLinks    = withNumber.length >= 15 ? withNumber : playerLinks; // safety fallback
  console.log(`[playerStats] ${team.name}: ${squadLinks.length} squad players (shirt-number filtered)`);
  squadLinks.forEach(p =>
    console.log(`[playerStats]   · #${p.shirtNumber ?? '?'} "${p.name}"  id=${p.playerId}`)
  );
  return squadLinks;
}

// ── Player page ───────────────────────────────────────────────────────────────

async function scrapePlayerNationalStats(page, player) {
  console.log(`\n[playerStats] ── #${player.shirtNumber ?? '?'} "${player.name}"  ${player.url}`);

  await gotoWithRetry(page, player.url, player.name);
  await page.waitForTimeout(1500);

  // ── Click "National Team" tab ─────────────────────────────────────────────
  let tabFound = false;

  const tabAttempts = [
    () => page.locator('button[data-testid="wcl-tab"]').filter({ hasText: /national\s*team/i }).first(),
    () => page.locator('button[data-testid="wcl-tab"]').filter({ hasText: /national/i }).first(),
    () => page.locator('[role="tab"]').filter({ hasText: /national\s*team/i }).first(),
    () => page.locator('button, [role="tab"]').filter({ hasText: /national/i }).first(),
    () => page.locator('a').filter({ hasText: /national\s*team/i }).first(),
  ];

  for (const getLocator of tabAttempts) {
    try {
      const loc = getLocator();
      if (await loc.isVisible({ timeout: 2000 })) {
        await loc.click();
        tabFound = true;
        console.log(`[playerStats]   National Team tab: clicked ✓`);
        break;
      }
    } catch { /* try next */ }
  }

  if (!tabFound) {
    try {
      const tabs = await page.evaluate(() =>
        [...document.querySelectorAll('button[data-testid="wcl-tab"], [role="tab"]')]
          .map(t => t.textContent.trim()).filter(t => t && t.length < 40)
      );
      console.log(`[playerStats]   tabs available: [${tabs.join(' | ')}]`);
    } catch { /* ignore */ }
    console.log(`[playerStats]   National Team tab: NOT FOUND`);
    return null;
  }

  await page.waitForTimeout(5000);
  await page.mouse.wheel(0, 1000);
  await page.waitForTimeout(2000);
  await page.waitForLoadState('networkidle').catch(() => {});

  if (DEBUG) {
    const slug = player.url.replace(/\/$/, '').split('/').slice(-2)[0] || 'player';
    await page.screenshot({ path: path.join(DEBUG_DIR, `${slug}-national-tab.png`), fullPage: true }).catch(() => {});
  }

  // ── Step 1: DOM headers (via title attribute — no className.split) ─────────
  const domHeaders = await page.evaluate(() => {
    const headerRow =
      document.querySelector('.careerTab__row.careerTab__row--main') ||
      [...document.querySelectorAll('[class*="careerTab__row"]')]
        .find(e => String(e.className).includes('main')) ||
      null;

    if (!headerRow) return [];

    const statEls = [...new Set([
      ...headerRow.querySelectorAll('.careerTab__stat'),
      ...headerRow.querySelectorAll('[class*="careerTab__stat"]'),
    ])];
    return statEls.map(el => (el.getAttribute('title') || el.textContent || '').trim());
  });

  // ── Step 2: body text for TOTAL values ────────────────────────────────────
  const bodyText = await page.locator('body').innerText().catch(() => '');

  if (DEBUG) {
    const ntStart = bodyText.search(/national\s*team/i);
    const section = ntStart >= 0 ? bodyText.slice(ntStart, ntStart + 3000) : bodyText.slice(0, 3000);
    console.log(`[playerStats]   -- NATIONAL TEAM section --`);
    console.log(section);
    console.log(`[playerStats]   -- END --`);
    console.log(`[playerStats]   DOM headers (${domHeaders.length}): [${domHeaders.join(' | ')}]`);
  }

  // parseTotalFromBodyText now defaults to count=6 when domHeaders.length=0
  const totalValues = parseTotalFromBodyText(bodyText, domHeaders.length);

  if (DEBUG) {
    console.log(`[playerStats]   totalValues (${totalValues?.length ?? 0}): [${(totalValues || []).join(' | ')}]`);
  }

  if (totalValues) {
    return buildResult(domHeaders, totalValues, bodyText);
  }

  // DOM fallback: read stat values directly from the total row
  const domValues = await page.evaluate(() => {
    const totalRow =
      document.querySelector('.careerTab__row.careerTab__row--total') ||
      [...document.querySelectorAll('[class*="careerTab__row"]')]
        .find(e => String(e.className).includes('total')) ||
      [...document.querySelectorAll('[class*="careerTab"]')]
        .find(e => /^total$/i.test(e.textContent.trim()))
        ?.parentElement;
    if (!totalRow) return null;

    const statEls = [...new Set([
      ...totalRow.querySelectorAll('.careerTab__stat'),
      ...totalRow.querySelectorAll('[class*="careerTab__stat"]'),
    ])];
    return statEls.map(el => {
      const t = el.textContent.trim();
      return (t === '-' || t === '') ? null : t;
    });
  });

  if (domValues?.length) {
    console.log(`[playerStats]   using DOM fallback for total values: [${domValues.join(' | ')}]`);
    return buildResult(domHeaders, domValues, bodyText);
  }

  console.log(`[playerStats]   ✗ TOTAL row not found in body text or DOM`);
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

async function scrapeTeamPlayerNationalStats(db, team, { limit } = {}) {
  console.log(`\n[playerStats] ====== ${team.name} — player national stats ======`);

  const browser = await chromium.launch({
    headless: !DEBUG,
    slowMo:    DEBUG ? 300 : 0,
  });
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

  const summary = {
    team:            team.name,
    players_found:   0,
    updated:         0,
    no_national_tab: 0,
    failed:          0,
    errors:          [],
    scraped_at:      new Date().toISOString(),
  };

  try {
    let playerLinks = await scrapeSquadPlayerLinks(page, team);
    summary.players_found = playerLinks.length;
    if (!playerLinks.length) throw new Error('No player links found on squad page');

    if (limit && limit > 0) {
      console.log(`[playerStats] TEST MODE: limiting to first ${limit} players`);
      playerLinks = playerLinks.slice(0, limit);
    }

    const upsert = db.prepare(`
      INSERT INTO player_national_stats
        (team_slug, team_code, player_name, player_url,
         soccerway_player_id, shirt_number,
         appearances, minutes, goals, assists,
         yellow_cards, red_cards, saves_pct, clean_sheets,
         senior_stats, scraped_at)
      VALUES
        (@team_slug, @team_code, @player_name, @player_url,
         @soccerway_player_id, @shirt_number,
         @appearances, @minutes, @goals, @assists,
         @yellow_cards, @red_cards, @saves_pct, @clean_sheets,
         @senior_stats, @scraped_at)
      ON CONFLICT(player_url) DO UPDATE SET
        player_name         = excluded.player_name,
        team_slug           = excluded.team_slug,
        team_code           = excluded.team_code,
        soccerway_player_id = excluded.soccerway_player_id,
        shirt_number        = excluded.shirt_number,
        appearances         = excluded.appearances,
        minutes             = excluded.minutes,
        goals               = excluded.goals,
        assists             = excluded.assists,
        yellow_cards        = excluded.yellow_cards,
        red_cards           = excluded.red_cards,
        saves_pct           = excluded.saves_pct,
        clean_sheets        = excluded.clean_sheets,
        senior_stats        = excluded.senior_stats,
        scraped_at          = excluded.scraped_at
    `);

    for (const player of playerLinks) {
      try {
        const stats = await scrapePlayerNationalStats(page, player);

        upsert.run({
          team_slug:           team.slug,
          team_code:           team.code,
          player_name:         player.name,
          player_url:          player.url,
          soccerway_player_id: player.playerId    ?? null,
          shirt_number:        player.shirtNumber ?? null,
          appearances:  stats?.appearances  ?? null,
          minutes:      stats?.minutes      ?? null,
          goals:        stats?.goals        ?? null,
          assists:      stats?.assists      ?? null,
          yellow_cards: stats?.yellow_cards ?? null,
          red_cards:    stats?.red_cards    ?? null,
          saves_pct:    stats?.saves_pct    ?? null,
          clean_sheets: stats?.clean_sheets ?? null,
          senior_stats: null, // reserved for future use
          scraped_at:   summary.scraped_at,
        });

        summary.updated++;
        if (!stats) {
          summary.no_national_tab++;
          console.log(`[playerStats]   ○ saved without stats`);
        } else {
          console.log(
            `[playerStats]   ✓ apps=${stats.appearances} goals=${stats.goals} ` +
            `assists=${stats.assists} yc=${stats.yellow_cards} rc=${stats.red_cards}` +
            (stats.clean_sheets !== null ? ` cs=${stats.clean_sheets}` : '') +
            (stats.saves_pct    !== null ? ` sv%=${stats.saves_pct}`   : '')
          );
        }
      } catch (err) {
        console.error(`[playerStats]   ✗ FAILED "${player.name}": ${err.message}`);
        summary.failed++;
        summary.errors.push({ player: player.name, error: err.message });
      }

      await page.waitForTimeout(PLAYER_DELAY_MS + Math.floor(Math.random() * 1000));
    }
  } finally {
    await browser.close();
  }

  console.log(
    `[playerStats] ====== Done — found=${summary.players_found} ` +
    `updated=${summary.updated} no_tab=${summary.no_national_tab} failed=${summary.failed} ======\n`
  );
  return summary;
}

module.exports = { scrapeTeamPlayerNationalStats };
