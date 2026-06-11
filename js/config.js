// First kickoff: 2026-06-11 19:00 PT = 18:00 UTC
const FIRST_MATCH_UTC = new Date('2026-06-11T18:00:00Z');

// match_date = "YYYY-MM-DD", match_time = "HH:MM" — both PT (UTC+1 in June)
// A match locks 15 minutes before kickoff.
// Exception: 2026-06-11 20:00 (México vs África do Sul) — open until 10 min after kickoff.
function getMatchLockAt(matchDate, matchTime) {
  const kickoff = new Date(`${matchDate}T${matchTime}:00+01:00`).getTime();
  if (matchDate === '2026-06-11' && matchTime === '20:00') return kickoff + 600000;
  return kickoff - 900000;
}

function isMatchLocked(matchDate, matchTime) {
  return Date.now() >= getMatchLockAt(matchDate, matchTime);
}

function timeUntilFirstMatch() {
  return _fmtDiff(FIRST_MATCH_UTC.getTime() - Date.now());
}

function timeUntilMatchLock(matchDate, matchTime) {
  return _fmtDiff(getMatchLockAt(matchDate, matchTime) - Date.now());
}

function _fmtDiff(diff) {
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function nextOpenMatchInfo(matches) {
  const now  = Date.now();
  const next = (matches || [])
    .map(m => ({ m, lockAt: getMatchLockAt(m.match_date, m.match_time) }))
    .filter(({ lockAt }) => now < lockAt)
    .sort((a, b) => a.lockAt - b.lockAt)[0];
  return next ? { match: next.m, lockAt: next.lockAt } : null;
}

function renderNextLockCountdown(matches) {
  const wrap = document.getElementById('countdownWrap');
  const val  = document.getElementById('countdownVal');
  const cta  = document.getElementById('ctaWrap');
  if (!wrap) return;
  const info = nextOpenMatchInfo(matches);
  if (!info) { wrap.style.display = 'none'; return; }
  const { match: m, lockAt } = info;
  const diff    = lockAt - Date.now();
  const urgent  = diff < 1800000;
  const timeStr = _fmtDiff(diff) || '< 1m';
  val.innerHTML = `${m.home_flag} ${m.home_team} vs ${m.away_team} ${m.away_flag} · encerra em <strong>${timeStr}</strong>`;
  wrap.className = urgent ? 'countdown countdown-urgent' : 'countdown';
  wrap.style.display = '';
  if (cta) cta.style.display = '';
}

// Returns an HTML snippet for the earliest open match deadline in a group
function groupDeadlineHtml(groupMatches) {
  const open = groupMatches
    .map(m => ({ m, lockAt: getMatchLockAt(m.match_date, m.match_time) }))
    .filter(({ lockAt }) => Date.now() < lockAt)
    .sort((a, b) => a.lockAt - b.lockAt)[0];

  if (!open) return '<span style="font-size:.7rem;color:var(--muted)">Encerrado</span>';

  const diff = open.lockAt - Date.now();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);

  if (diff < 3600000) {
    return `<span style="font-size:.7rem;color:var(--primary);font-weight:700">fecha em ${m}m</span>`;
  } else if (diff < 86400000) {
    const txt = h > 0 ? `${h}h ${m}m` : `${m}m`;
    return `<span style="font-size:.7rem;color:var(--gold)">fecha em ${txt}</span>`;
  } else {
    const lockDate = new Date(open.lockAt);
    const dateStr = lockDate.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'Europe/Lisbon' });
    const timeStr = lockDate.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
    return `<span style="font-size:.7rem;color:var(--muted)">até ${dateStr} ${timeStr}</span>`;
  }
}

const GROUP_LABELS = {
  A:'Grupo A', B:'Grupo B', C:'Grupo C', D:'Grupo D',
  E:'Grupo E', F:'Grupo F', G:'Grupo G', H:'Grupo H',
  I:'Grupo I', J:'Grupo J', K:'Grupo K', L:'Grupo L'
};

const ALL_GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

// Deterministic avatar color from username — same function used server-side
function avatarColor(str) {
  const p = ['#E61D25','#2A398D','#3CAC3B','#f5a623','#8b5cf6','#06b6d4','#f97316','#ec4899','#10b981','#a855f7'];
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return p[Math.abs(h) % p.length];
}

// Render an avatar circle — photo if available, robust initial fallback
function renderAvatar(user, size = 32, cls = '') {
  const color   = user.avatar_color || avatarColor(user.username || '');
  const initial = (user.display_name || user.username || '?').charAt(0).toUpperCase();
  const base    = `width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0;background:${color};display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:${Math.round(size*0.42)}px;overflow:hidden;position:relative;text-decoration:none;`;
  const title   = user.display_name || user.username || '';
  if (user.avatar_url) {
    return `<div class="avatar-gen ${cls}" style="${base}" title="${title}"><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${initial}</span><img src="${user.avatar_url}" style="width:100%;height:100%;object-fit:cover;position:relative;z-index:1" onerror="this.remove()"></div>`;
  }
  return `<div class="avatar-gen ${cls}" style="${base}" title="${title}">${initial}</div>`;
}
