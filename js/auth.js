async function requireAuth() {
  if (!localStorage.getItem('abm_token')) { window.location.href = 'index.html'; return null; }
  try {
    return await API.get('/me');
  } catch {
    localStorage.removeItem('abm_token');
    window.location.href = 'index.html';
    return null;
  }
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
