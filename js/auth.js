async function requireAuth() {
  if (!localStorage.getItem('abm_token')) { window.location.href = '/'; return null; }
  try {
    const user = await API.get('/me');
    setupNavbar(user);
    return user;
  } catch {
    localStorage.removeItem('abm_token');
    window.location.href = '/';
    return null;
  }
}

function setupNavbar(user) {
  // Avatar: custom photo > generated color initial
  const avatarEl = document.getElementById('navAvatar');
  if (avatarEl) {
    if (user.avatar_url) {
      avatarEl.style.backgroundImage  = `url(${user.avatar_url})`;
      avatarEl.style.backgroundSize   = 'cover';
      avatarEl.style.backgroundPosition = 'center';
      avatarEl.textContent = '';
    } else {
      const color = (typeof avatarColor === 'function')
        ? (user.avatar_color || avatarColor(user.username || ''))
        : (user.avatar_color || '#E61D25');
      avatarEl.textContent = (user.display_name || user.username || '?').charAt(0).toUpperCase();
      avatarEl.style.background = color;
    }
    avatarEl.style.cursor = 'pointer';
    avatarEl.title = 'O meu perfil';
    avatarEl.onclick = () => { window.location.href = `/profile?u=${user.username}`; };
  }
  // Admin link
  const adminLink = document.getElementById('navAdminLink');
  if (adminLink && user.is_admin) adminLink.style.display = '';
  // Notification bell
  setupNotificationBell(user);
}

async function setupNotificationBell(user) {
  // Inject bell before the avatar if not already present
  const right = document.querySelector('.navbar-right');
  if (!right || document.getElementById('navBell')) return;

  const bell = document.createElement('div');
  bell.id        = 'navBell';
  bell.className = 'nav-bell';
  bell.innerHTML = `
    <button class="nav-bell-btn" onclick="toggleNotifications()" title="Notificações">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span class="nav-bell-badge" id="bellBadge" style="display:none">0</span>
    </button>
    <div class="nav-bell-panel" id="bellPanel" style="display:none"></div>
  `;
  right.insertBefore(bell, right.firstChild);

  await refreshNotifications();
}

async function refreshNotifications() {
  try {
    const data    = await API.get('/notifications');
    const badge   = document.getElementById('bellBadge');
    const panel   = document.getElementById('bellPanel');
    if (!badge || !panel) return;

    if (data.unread > 0) {
      badge.textContent  = data.unread > 9 ? '9+' : data.unread;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }

    if (!data.notifications.length) {
      panel.innerHTML = '<p class="muted small" style="padding:16px;text-align:center">Sem notificações.</p>';
      return;
    }

    const TYPE_ICON = {
      friend_request:  '👥',
      friend_accepted: '✅',
      achievement:     '🏆',
      match_settled:   '⚽',
    };

    function renderNotif(n) {
      const icon = TYPE_ICON[n.type] || '🔔';
      const time = relativeNotifTime(n.created_at);
      const unread = n.read ? '' : 'notif-unread';

      if (n.type === 'friend_request' && n.body) {
        return `
          <div class="notif-row ${unread}" id="notif-${n.id}">
            <span class="notif-icon">${icon}</span>
            <div class="notif-body">
              <div class="notif-title">${n.title}</div>
              <div class="notif-time muted">${time}</div>
              <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn btn-primary btn-sm" style="font-size:.72rem;padding:3px 10px"
                  onclick="acceptFriendNotif(${n.body},${n.id})">Aceitar</button>
                <a href="${n.link || '#'}" class="btn btn-ghost btn-sm" style="font-size:.72rem;padding:3px 10px"
                  onclick="markRead(${n.id})">Ver perfil</a>
              </div>
            </div>
          </div>`;
      }
      return `
        <a href="${n.link || '#'}" class="notif-row ${unread}" onclick="markRead(${n.id})">
          <span class="notif-icon">${icon}</span>
          <div class="notif-body">
            <div class="notif-title">${n.title}</div>
            <div class="notif-time muted">${time}</div>
          </div>
        </a>`;
    }

    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border)">
        <strong style="font-size:.85rem">Notificações</strong>
        <button onclick="markAllRead()" class="btn btn-ghost btn-sm" style="font-size:.75rem;padding:2px 8px">Marcar todas lidas</button>
      </div>
      ${data.notifications.map(renderNotif).join('')}
    `;
  } catch { /* notifications optional */ }
}

function relativeNotifTime(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)  return 'agora';
  if (mins < 60) return `há ${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24)   return `há ${h}h`;
  return `há ${Math.floor(h/24)}d`;
}

function toggleNotifications() {
  const panel = document.getElementById('bellPanel');
  if (!panel) return;
  const open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  if (!open) refreshNotifications();
}

async function markRead(id) {
  await API.patch(`/notifications/${id}/read`).catch(() => {});
  refreshNotifications();
}

async function markAllRead() {
  await API.patch('/notifications/read-all').catch(() => {});
  refreshNotifications();
}

async function acceptFriendNotif(friendId, notifId) {
  const btn = document.querySelector(`#notif-${notifId} .btn-primary`);
  if (btn) { btn.disabled = true; btn.textContent = 'A aceitar...'; }
  try {
    await API.post(`/friends/${friendId}/accept`);
    await API.patch(`/notifications/${notifId}/read`).catch(() => {});
    showToast('Pedido de amizade aceite!');
  } catch (e) {
    showToast(e.message || 'Erro ao aceitar pedido', 'error');
  }
  refreshNotifications();
}

// Close bell panel when clicking outside
document.addEventListener('click', e => {
  const bell = document.getElementById('navBell');
  if (bell && !bell.contains(e.target)) {
    const panel = document.getElementById('bellPanel');
    if (panel) panel.style.display = 'none';
  }
});

function logout() {
  localStorage.removeItem('abm_token');
  window.location.href = '/';
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('pt-PT', { weekday:'short', day:'numeric', month:'short' });
}

function formatMatchMeta(m) {
  return `${formatDate(m.match_date)} ${m.match_time} (PT) · ${m.venue}`;
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.dataset.original = btn.dataset.original || btn.textContent;
  btn.textContent = loading ? 'A carregar...' : btn.dataset.original;
}
