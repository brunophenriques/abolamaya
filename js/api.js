// Thin REST client — wraps fetch with auth header and error handling
const API = (() => {
  async function req(method, path, body) {
    const token = localStorage.getItem('abm_token');
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch('/api' + path, opts);
    } catch {
      throw new Error('Sem ligação. Certifica-te que o servidor está a correr (npm start).');
    }

    if (res.status === 401) {
      localStorage.removeItem('abm_token');
      window.location.href = 'index.html';
      return null;
    }

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Servidor não encontrado. Abre http://localhost:3000 depois de correr "npm start".`);
    }
    if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
    return data;
  }

  return {
    get:    path       => req('GET',    path),
    post:   (path, b)  => req('POST',   path, b),
    put:    (path, b)  => req('PUT',    path, b),
    delete: path       => req('DELETE', path),
  };
})();
