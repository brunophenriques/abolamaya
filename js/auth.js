async function requireAuth() {
  if (!localStorage.getItem('abm_token')) { window.location.href = 'index.html'; return null; }
  try {
    const user = await API.get('/me');
    setupNavbar(user);
    return user;
  } catch {
    localStorage.removeItem('abm_token');
    window.location.href = 'index.html';
    return null;
  }
}

function setupNavbar(user) {
  // Avatar initial + color
  const avatarEl = document.getElementById('navAvatar');
  if (avatarEl) {
    const color = (typeof avatarColor === 'function')
      ? (user.avatar_color || avatarColor(user.username || ''))
      : (user.avatar_color || '#E61D25');
    avatarEl.textContent = (user.display_name || user.username || '?').charAt(0).toUpperCase();
    avatarEl.style.background = color;
    avatarEl.style.cursor = 'pointer';
    avatarEl.onclick = () => { window.location.href = `profile.html?u=${user.username}`; };
  }
  // Admin link
  const adminLink = document.getElementById('navAdminLink');
  if (adminLink && user.is_admin) adminLink.style.display = '';
}

function logout() {
  localStorage.removeItem('abm_token');
  window.location.href = 'index.html';
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
