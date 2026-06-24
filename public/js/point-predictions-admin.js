let _pointAdminData = null;

const POINT_CATEGORY_LABELS = {
  match: 'Jogo',
  player: 'Jogador',
  group: 'Grupo',
  world_cup: 'Mundial',
  other: 'Outra',
};

const POINT_STATUS_LABELS = {
  draft: 'Rascunho',
  open: 'Aberta',
  locked: 'Fechada',
  resolved: 'Resolvida',
  void: 'Anulada',
};

async function loadPointPredictionsAdmin() {
  const container = document.getElementById('pointPredictionsAdmin');
  if (!container) return;
  container.innerHTML = '<span class="muted small">A carregar...</span>';
  try {
    _pointAdminData = await API.get('/admin/point-predictions/dashboard');
    renderPointPredictionsAdmin();
  } catch (error) {
    container.innerHTML = `<span class="form-error">${pointAdminEscape(error.message)}</span>`;
  }
}

function renderPointPredictionsAdmin() {
  const container = document.getElementById('pointPredictionsAdmin');
  const { settings, community_vote: vote, predictions } = _pointAdminData;
  const final = predictions.filter(item => ['resolved', 'void'].includes(item.status));
  const active = predictions.filter(item => !['resolved', 'void'].includes(item.status));
  const decided = vote.yes + vote.no;
  const yesPercent = decided ? Math.round(vote.yes / decided * 1000) / 10 : 0;
  const noPercent = decided ? Math.round(vote.no / decided * 1000) / 10 : 0;

  container.innerHTML = `
    <div class="point-admin-layout">
      <section class="card">
        <div class="card-title">Controlo da funcionalidade</div>
        ${pointAdminToggle('Sistema de previsões com pontos', 'enabled', settings.enabled, 'Disponibiliza a página, navegação e votação com saldo.')}
        ${pointAdminToggle('Votação comunitária', 'community_vote_open', settings.community_vote_open, 'Mostra o modal aos utilizadores que ainda não decidiram.')}
        ${pointAdminToggle('Modo beta', 'beta_mode', settings.beta_mode, 'Identifica internamente a funcionalidade como beta.')}
      </section>

      <section class="card">
        <div class="flex-between">
          <div class="card-title">Votação comunitária</div>
          <strong>${vote.total} respostas</strong>
        </div>
        <div class="point-admin-vote-stats">
          <div><span>Sim</span><strong>${vote.yes}</strong><small>${yesPercent}% dos decididos</small></div>
          <div><span>Não</span><strong>${vote.no}</strong><small>${noPercent}% dos decididos</small></div>
          <div><span>Mais tarde</span><strong>${vote.later}</strong><small>podem voltar a decidir</small></div>
        </div>
      </section>
    </div>

    <section class="card mt-12">
      <div class="flex-between" style="gap:12px;flex-wrap:wrap">
        <div>
          <div class="card-title" style="margin-bottom:3px">Criar previsão</div>
          <p class="muted small">As opções são sempre Sim e Não. Cada participação reserva um ponto.</p>
        </div>
      </div>
      <form class="point-admin-create" onsubmit="createPointPrediction(event)">
        <label class="form-group point-admin-question">
          <span>Pergunta</span>
          <input class="input" id="pointQuestion" maxlength="240" required placeholder="Ex.: Portugal vence o próximo jogo?">
        </label>
        <label class="form-group">
          <span>Categoria</span>
          <select class="input" id="pointCategory">
            ${Object.entries(POINT_CATEGORY_LABELS).map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
        </label>
        <label class="form-group">
          <span>Deadline</span>
          <input class="input" type="datetime-local" id="pointDeadline" required>
        </label>
        <label class="form-group">
          <span>Estado inicial</span>
          <select class="input" id="pointInitialStatus">
            <option value="draft">Rascunho</option>
            <option value="open">Abrir imediatamente</option>
          </select>
        </label>
        <button class="btn btn-primary" type="submit">Criar previsão</button>
      </form>
    </section>

    <section class="card mt-12">
      <div class="flex-between">
        <div class="card-title">Previsões por gerir</div>
        <button class="btn btn-ghost btn-sm" onclick="loadPointPredictionsAdmin()">Atualizar</button>
      </div>
      ${renderPointAdminTable(active, false)}
    </section>

    <section class="card mt-12">
      <div class="card-title">Histórico</div>
      ${renderPointAdminTable(final, true)}
    </section>`;
}

function pointAdminToggle(label, key, checked, description) {
  return `
    <label class="toggle-row">
      <span><strong>${label}</strong><small class="muted" style="display:block">${description}</small></span>
      <input type="checkbox" ${checked ? 'checked' : ''} onchange="updatePointSetting('${key}',this.checked)">
    </label>`;
}

function renderPointAdminTable(items, history) {
  if (!items.length) return `<p class="muted small">Sem previsões nesta secção.</p>`;
  return `
    <div class="point-admin-table-wrap">
      <table class="standings-table point-admin-table">
        <thead><tr>
          <th>Pergunta</th><th>Sim</th><th>Não</th><th>Pool</th><th>Deadline</th><th>Estado</th><th></th>
        </tr></thead>
        <tbody>${items.map(item => `
          <tr>
            <td><strong>${pointAdminEscape(item.question)}</strong><small>${POINT_CATEGORY_LABELS[item.category]}</small></td>
            <td>${item.yes_votes}</td><td>${item.no_votes}</td><td>${item.pool_total}</td>
            <td>${new Date(item.closes_at).toLocaleString('pt-PT')}</td>
            <td>${POINT_STATUS_LABELS[item.status]}${item.result ? ` · ${item.result === 'yes' ? 'Sim' : 'Não'}` : ''}</td>
            <td class="point-admin-actions">
              ${history
                ? `<button class="btn btn-ghost btn-sm" onclick="showPointHistory(${item.id})">Detalhes</button>`
                : `
                  <button class="btn btn-ghost btn-sm" onclick="editPointPrediction(${item.id})">Editar</button>
                  ${item.status === 'open' ? `<button class="btn btn-ghost btn-sm" onclick="closePointPrediction(${item.id})">Fechar</button>` : ''}
                  ${item.status === 'draft' ? `<button class="btn btn-ghost btn-sm" onclick="openPointPrediction(${item.id})">Abrir</button>` : ''}
                  <button class="btn btn-primary btn-sm" onclick="openPointResolve(${item.id})">Resolver</button>`}
            </td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

async function updatePointSetting(key, checked) {
  try {
    await API.patch('/admin/point-predictions/settings', { [key]: checked });
    showToast('Definição atualizada.');
    await loadPointPredictionsAdmin();
  } catch (error) {
    showToast(error.message, 'error');
    await loadPointPredictionsAdmin();
  }
}

async function createPointPrediction(event) {
  event.preventDefault();
  try {
    await API.post('/admin/point-predictions', {
      question: document.getElementById('pointQuestion').value,
      category: document.getElementById('pointCategory').value,
      closes_at: new Date(document.getElementById('pointDeadline').value).toISOString(),
      status: document.getElementById('pointInitialStatus').value,
    });
    event.target.reset();
    showToast('Previsão criada.');
    await loadPointPredictionsAdmin();
  } catch (error) { showToast(error.message, 'error'); }
}

function editPointPrediction(id) {
  const item = _pointAdminData.predictions.find(prediction => prediction.id === id);
  if (!item) return;
  openPointAdminModal(`
    <div class="flex-between"><h3>Editar previsão</h3><button class="point-admin-close" onclick="closePointAdminModal()">×</button></div>
    <form onsubmit="savePointPrediction(event,${id})">
      <label class="form-group"><span>Pergunta</span><input class="input" id="editPointQuestion" maxlength="240" value="${pointAdminEscape(item.question)}" required></label>
      <div class="point-admin-form-grid">
        <label class="form-group"><span>Categoria</span><select class="input" id="editPointCategory">${Object.entries(POINT_CATEGORY_LABELS).map(([value,label]) => `<option value="${value}" ${item.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <label class="form-group"><span>Deadline</span><input class="input" type="datetime-local" id="editPointDeadline" value="${pointLocalDateTime(item.closes_at)}" required></label>
      </div>
      <button class="btn btn-primary" type="submit">Guardar alterações</button>
    </form>`);
}

async function savePointPrediction(event, id) {
  event.preventDefault();
  try {
    await API.patch(`/admin/point-predictions/${id}`, {
      question: document.getElementById('editPointQuestion').value,
      category: document.getElementById('editPointCategory').value,
      closes_at: new Date(document.getElementById('editPointDeadline').value).toISOString(),
    });
    closePointAdminModal();
    showToast('Previsão atualizada.');
    await loadPointPredictionsAdmin();
  } catch (error) { showToast(error.message, 'error'); }
}

async function closePointPrediction(id) {
  try {
    await API.post(`/admin/point-predictions/${id}/close`);
    showToast('Previsão fechada.');
    await loadPointPredictionsAdmin();
  } catch (error) { showToast(error.message, 'error'); }
}

async function openPointPrediction(id) {
  const item = _pointAdminData.predictions.find(prediction => prediction.id === id);
  if (!item) return;
  try {
    await API.patch(`/admin/point-predictions/${id}`, { status: 'open' });
    showToast('Previsão aberta.');
    await loadPointPredictionsAdmin();
  } catch (error) { showToast(error.message, 'error'); }
}

function openPointResolve(id) {
  const item = _pointAdminData.predictions.find(prediction => prediction.id === id);
  if (!item) return;
  openPointAdminModal(`
    <div class="flex-between"><h3>Resolver previsão</h3><button class="point-admin-close" onclick="closePointAdminModal()">×</button></div>
    <p class="point-admin-modal-question">${pointAdminEscape(item.question)}</p>
    <div class="point-resolve-choices">
      <button onclick="previewPointResolution(${id},'yes',this)">Sim ganhou</button>
      <button onclick="previewPointResolution(${id},'no',this)">Não ganhou</button>
      <button onclick="previewPointResolution(${id},'void',this)">Anular previsão</button>
    </div>
    <div id="pointResolvePreview" class="point-resolve-preview muted">Escolhe o resultado para veres o resumo antes de confirmar.</div>`);
}

async function previewPointResolution(id, result, button) {
  document.querySelectorAll('.point-resolve-choices button').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const preview = document.getElementById('pointResolvePreview');
  preview.innerHTML = 'A calcular...';
  try {
    const data = await API.get(`/admin/point-predictions/${id}/resolve-preview?result=${result}`);
    preview.innerHTML = `
      <div class="point-resolve-metrics">
        <div><span>Pool</span><strong>${data.pool_total}</strong></div>
        <div><span>Vencedores</span><strong>${data.winner_count}</strong></div>
        <div><span>Payout</span><strong>${data.payout_per_winner}</strong></div>
        <div><span>Total pago</span><strong>${data.total_paid}</strong></div>
        <div><span>Inflação</span><strong>${data.inflation}</strong></div>
        <div><span>Sim / Não</span><strong>${data.yes_votes} / ${data.no_votes}</strong></div>
      </div>
      <button class="btn btn-primary" onclick="confirmPointResolution(${id},'${result}')">${result === 'void' ? 'Confirmar anulação' : 'Confirmar resultado'}</button>`;
  } catch (error) { preview.innerHTML = `<span class="form-error">${pointAdminEscape(error.message)}</span>`; }
}

async function confirmPointResolution(id, result) {
  try {
    await API.post(`/admin/point-predictions/${id}/resolve`, { result });
    closePointAdminModal();
    showToast(result === 'void' ? 'Previsão anulada e pontos devolvidos.' : 'Previsão resolvida.');
    await loadPointPredictionsAdmin();
  } catch (error) { showToast(error.message, 'error'); }
}

function showPointHistory(id) {
  const item = _pointAdminData.predictions.find(prediction => prediction.id === id);
  if (!item) return;
  openPointAdminModal(`
    <div class="flex-between"><h3>Detalhes da previsão</h3><button class="point-admin-close" onclick="closePointAdminModal()">×</button></div>
    <p class="point-admin-modal-question">${pointAdminEscape(item.question)}</p>
    <div class="point-resolve-metrics">
      <div><span>Estado</span><strong>${POINT_STATUS_LABELS[item.status]}</strong></div>
      <div><span>Resultado</span><strong>${item.result ? (item.result === 'yes' ? 'Sim' : 'Não') : 'Anulada'}</strong></div>
      <div><span>Votos</span><strong>${item.pool_total}</strong></div>
      <div><span>Vencedores</span><strong>${item.winner_count ?? 0}</strong></div>
      <div><span>Payout</span><strong>${item.payout_per_winner ?? 0}</strong></div>
      <div><span>Inflação</span><strong>${item.inflation ?? 0}</strong></div>
    </div>
    <p class="muted small">Resolvida em ${item.resolved_at ? new Date(item.resolved_at).toLocaleString('pt-PT') : '—'}</p>`);
}

function openPointAdminModal(html) {
  document.getElementById('pointAdminModalContent').innerHTML = html;
  document.getElementById('pointAdminModal').style.display = '';
}
function closePointAdminModal() {
  document.getElementById('pointAdminModal').style.display = 'none';
}
function pointAdminEscape(value) {
  return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function pointLocalDateTime(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0,16);
}
