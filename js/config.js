const PREDICTION_DEADLINE = new Date('2026-06-11T18:00:00Z'); // 1h antes do 1º jogo

function isPredictionLocked() {
  return Date.now() > PREDICTION_DEADLINE.getTime();
}

function timeUntilDeadline() {
  const diff = PREDICTION_DEADLINE.getTime() - Date.now();
  if (diff <= 0) return null;
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
