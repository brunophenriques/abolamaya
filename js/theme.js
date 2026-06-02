// Theme management — call initTheme() inline in <head> of each page to avoid FOUC
function toggleTheme() {
  const html = document.documentElement;
  const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  localStorage.setItem('abm_theme', next);
}
