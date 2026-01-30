function hfApplyPermissions(){ try { if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document); } catch {} }

// public/js/leads.js
// Leads pipeline (kanban) + notes + conversion flow.
// Code/comments in English per project standard.

let state = {
  leads: [],
  filtered: [],
  selectedLead: null,
};

let leadSelecionadoId = null;

const STATUS_LABEL = {
  novo: 'Novo',
  em_atendimento: 'Em atendimento',
  orcamento_enviado: 'Orçamento enviado',
  follow_up: 'Follow-up',
  fechado: 'Fechado',
  perdido: 'Perdido',
};

function el(id) { return document.getElementById(id); }

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(iso) {
  if (!iso) return '';
  // D1 stores CURRENT_TIMESTAMP as 'YYYY-MM-DD HH:MM:SS'
  const s = String(iso).replace(' ', 'T') + (String(iso).includes('T') ? '' : '');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('pt-BR');
}

function buildWhatsAppLink(phone, name) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '#';
  const msg = `Olá, ${name || ''}! Aqui é da Home Fest 😊`;
  return `https://wa.me/55${digits}?text=${encodeURIComponent(msg)}`;
}

async function window.hfApiJson(url, opts = {}) {
  // Delegates to the shared shell helper:
  // - credentials: include
  // - 401 redirects
  // - 403 shows toast
  return window.hfApiJson(url, opts);
}

function applyFilter() {
  const q = (el('q').value || '').trim().toLowerCase();
  if (!q) {
    state.filtered = [...state.leads];
    return;
  }
  state.filtered = state.leads.filter(l => {
    const hay = `${l.nome || ''} ${l.telefone || ''} ${l.email || ''} ${l.origem || ''} ${l.cidade || ''} ${l.bairro || ''}`.toLowerCase();
    return hay.includes(q);
  });
}

function setCounts(groups) {
  const keys = Object.keys(STATUS_LABEL);
  keys.forEach(k => {
    const c = groups[k]?.length || 0;
    const node = el(`count_${k}`);
    if (node) node.textContent = String(c);
  });
}

function groupByStatus(leads) {
  const g = { novo: [], em_atendimento: [], orcamento_enviado: [], follow_up: [], fechado: [], perdido: [] };
  leads.forEach(l => {
    const st = g[l.status] ? l.status : 'novo';
    g[st].push(l);
  });
  return g;
}

function renderKanban() {
  applyFilter();
  const groups = groupByStatus(state.filtered);
  setCounts(groups);

  document.querySelectorAll('.kanban-drop').forEach(zone => zone.innerHTML = '');

  for (const [status, list] of Object.entries(groups)) {
    const zone = document.querySelector(`.kanban-drop[data-drop="${status}"]`);
    if (!zone) continue;

    list.forEach(l => {
      const card = document.createElement('div');
      card.className = 'lead-card';
      card.setAttribute('draggable', 'true');
      card.dataset.id = String(l.id);

      const badge = `<span class="badge badge-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
      const origin = l.origem ? `<span class="chip">${esc(l.origem)}</span>` : '';
      const city = l.cidade ? `<span class="chip">${esc(l.cidade)}</span>` : '';

      card.innerHTML = `
        <div class="lead-top">
          <div class="lead-name">${esc(l.nome)}</div>
          ${badge}
        </div>
        <div class="lead-meta">
          <span class="meta">${esc(l.telefone || '—')}</span>
          <span class="meta">${esc(l.bairro || '')}</span>
        </div>
        <div class="lead-tags">${origin}${city}</div>
      `;

      card.addEventListener('click', (e) => {
        // avoid click when dragging
        if (card.classList.contains('is-dragging')) return;
        openDrawer(l.id);
      });

      card.addEventListener('dragstart', (e) => {
        card.classList.add('is-dragging');
        e.dataTransfer.setData('text/plain', String(l.id));
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('is-dragging');
      });

      zone.appendChild(card);
    });
  }
}

function wireKanbanDnD() {
  document.querySelectorAll('.kanban-drop').forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      const id = e.dataTransfer.getData('text/plain');
      const newStatus = zone.dataset.drop;
      if (!id || !newStatus) return;
      await updateLeadStatus(Number(id), newStatus);
    });
  });
}

async function loadLeads() {
  state.leads = await window.hfApiJson('/api/leads');
  renderKanban();
}

async function createLead() {
  const payload = {
    nome: el('nome').value,
    telefone: el('telefone').value,
    email: el('email').value,
    cidade: el('cidade').value,
    bairro: el('bairro').value,
    origem: el('origem').value,
    status: el('status').value,
    observacoes: el('observacoes').value,
  };

  await window.hfApiJson('/api/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // reset form
  ['nome','telefone','email','cidade','bairro','origem','observacoes'].forEach(id => el(id).value = '');
  el('status').value = 'novo';
  closeNovoLead();
  await loadLeads();
  hfApplyPermissions();
}

async function updateLeadStatus(id, status) {
  // optimistic update
  const lead = state.leads.find(x => Number(x.id) === Number(id));
  if (!lead) return;
  const old = lead.status;
  lead.status = status;
  renderKanban();

  try {
    await window.hfApiJson('/api/leads/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (state.selectedLead && Number(state.selectedLead.id) === Number(id)) {
      el('d_status').value = status;
    }
  } catch (err) {
    lead.status = old;
    renderKanban();
    alert('Erro ao atualizar status: ' + err.message);
  }
}

function openNovoLead() {
  el('novoLeadCard').hidden = false;
  el('nome').focus();
}
function closeNovoLead() {
  el('novoLeadCard').hidden = true;
}

function openDrawerByLead(lead) {
  state.selectedLead = lead;

  el('d_nome').textContent = lead.nome || 'Lead';
  el('d_sub').textContent = `#${lead.id} · Criado em ${formatDateTime(lead.criado_em)}`;
  el('d_tel').textContent = lead.telefone || '—';
  el('d_email').textContent = lead.email || '—';
  el('d_local').textContent = `${lead.cidade || '—'}${lead.bairro ? ' · ' + lead.bairro : ''}`;
  el('d_origem').textContent = lead.origem || '—';
  el('d_status').value = lead.status || 'novo';

  const wa = buildWhatsAppLink(lead.telefone, lead.nome);
  const btnWhats = el('btnWhats');
  btnWhats.href = wa;
  btnWhats.setAttribute('aria-disabled', wa === '#' ? 'true' : 'false');
  if (wa === '#') btnWhats.classList.add('is-disabled'); else btnWhats.classList.remove('is-disabled');

  el('btnConverter').disabled = (lead.status === 'fechado');
  el('btnConverter').title = (lead.status === 'fechado') ? 'Lead já está fechado' : '';

  // Hide edit panel by default
  try { el('editLead').hidden = true; } catch {}

  const drawer = el('drawer');
  drawer.classList.remove('hidden');
  drawer.setAttribute('aria-hidden', 'false');

  loadNotes(lead.id).catch(() => {
    el('notesList').innerHTML = '<div class="muted">Não foi possível carregar o histórico.</div>';
  });
}

function openEditLead() {
  const lead = state.selectedLead;
  if (!lead) return;

  // Pre-fill form
  el('e_nome').value = lead.nome || '';
  el('e_telefone').value = lead.telefone || '';
  el('e_email').value = lead.email || '';
  el('e_cidade').value = lead.cidade || '';
  el('e_bairro').value = lead.bairro || '';
  el('e_origem').value = lead.origem || '';
  el('e_observacoes').value = lead.observacoes || '';

  el('editLead').hidden = false;
  el('e_nome').focus();
  hfApplyPermissions();
}

function cancelEditLead() {
  try { el('editLead').hidden = true; } catch {}
}

async function saveEditLead() {
  const lead = state.selectedLead;
  if (!lead) return;

  const payload = {
    nome: el('e_nome').value,
    telefone: el('e_telefone').value,
    email: el('e_email').value,
    cidade: el('e_cidade').value,
    bairro: el('e_bairro').value,
    origem: el('e_origem').value,
    observacoes: el('e_observacoes').value,
  };

  await window.hfApiJson('/api/leads/' + lead.id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  // Update local state
  Object.assign(lead, payload);
  // Update drawer display fields
  el('d_nome').textContent = lead.nome || 'Lead';
  el('d_tel').textContent = lead.telefone || '—';
  el('d_email').textContent = lead.email || '—';
  el('d_local').textContent = `${lead.cidade || '—'}${lead.bairro ? ' · ' + lead.bairro : ''}`;
  el('d_origem').textContent = lead.origem || '—';

  cancelEditLead();
  renderKanban();
  hfApplyPermissions();
}

async function openDrawer(id) {
  const lead = state.leads.find(l => Number(l.id) === Number(id));
  if (!lead) return;
  openDrawerByLead(lead);
}

function closeDrawer() {
  const drawer = el('drawer');
  drawer.classList.add('hidden');
  drawer.setAttribute('aria-hidden', 'true');
  state.selectedLead = null;
  el('notesList').innerHTML = '';
  el('noteText').value = '';
}

async function loadNotes(leadId) {
  const notes = await window.hfApiJson('/api/leads/' + leadId + '/notes');
  const list = el('notesList');
  if (!notes.length) {
    list.innerHTML = '<div class="muted">Nenhuma nota ainda. Registre o primeiro contato!</div>';
    return;
  }
  list.innerHTML = notes.map(n => `
    <div class="note-item">
      <div class="note-text">${esc(n.note)}</div>
      <div class="note-meta muted">${esc(n.created_by || '—')} · ${esc(formatDateTime(n.created_at))}</div>
    </div>
  `).join('');
}

async function addNote() {
  const lead = state.selectedLead;
  if (!lead) return;
  const note = (el('noteText').value || '').trim();
  if (!note) return;

  await window.hfApiJson('/api/leads/' + lead.id + '/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note }),
  });

  el('noteText').value = '';
  await loadNotes(lead.id);
}

async function onDrawerStatusChange() {
  const lead = state.selectedLead;
  if (!lead) return;
  const status = el('d_status').value;
  await updateLeadStatus(lead.id, status);
}

async function deleteSelectedLead() {
  const lead = state.selectedLead;
  if (!lead) return;
  const ok = confirm(`Excluir lead "${lead.nome}"?`);
  if (!ok) return;

  await window.hfApiJson('/api/leads/' + lead.id, { method: 'DELETE' });
  closeDrawer();
  await loadLeads();
  hfApplyPermissions();
}

function abrirModalConverter() {
  const lead = state.selectedLead;
  if (!lead) return;
  leadSelecionadoId = lead.id;

  el('modalLeadNome').textContent = lead.nome || '';
  el('m_tipo_evento').value = 'Infantil';
  el('m_status_evento').value = 'orcamento';
  el('m_data_evento').value = '';
  el('m_convidados').value = '';
  el('m_valor_total').value = '';
  el('m_valor_sinal').value = '';
  el('m_forma_pagamento').value = '50% agora e 50% até 1 semana antes';
  el('m_obs').value = '';

  const modal = el('modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function fecharModal() {
  const modal = el('modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  leadSelecionadoId = null;
}

async function confirmarFechamento() {
  if (!leadSelecionadoId) return;

  const payload = {
    tipo_evento: el('m_tipo_evento').value,
    status_evento: el('m_status_evento').value,
    data_evento: el('m_data_evento').value || null,
    convidados: Number(el('m_convidados').value || 0),
    valor_total: Number(el('m_valor_total').value || 0),
    valor_sinal: Number(el('m_valor_sinal').value || 0),
    forma_pagamento: el('m_forma_pagamento').value,
    observacoes: el('m_obs').value || null,
  };

  const out = await window.hfApiJson('/api/leads/' + leadSelecionadoId + '/converter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  fecharModal();
  await loadLeads();
  hfApplyPermissions();

  // Go straight to the event central to keep the flow tight
  window.location.href = '/app/festa?id=' + out.evento_id;
}

function wireUI() {
  el('btnToggleNovo').addEventListener('click', () => {
    const isHidden = el('novoLeadCard').hidden;
    if (isHidden) openNovoLead(); else closeNovoLead();
  });
  el('btnCancelarNovo').addEventListener('click', closeNovoLead);
  el('btnSalvarLead').addEventListener('click', createLead);

  el('q').addEventListener('input', () => renderKanban());

  el('btnFecharDrawer').addEventListener('click', closeDrawer);
  el('drawerBackdrop').addEventListener('click', closeDrawer);

  el('btnNoteClear').addEventListener('click', () => el('noteText').value = '');
  el('btnAddNote').addEventListener('click', addNote);

  el('d_status').addEventListener('change', onDrawerStatusChange);

  el('btnExcluir').addEventListener('click', deleteSelectedLead);
  el('btnConverter').addEventListener('click', abrirModalConverter);
  el('btnEditar').addEventListener('click', openEditLead);
  el('btnCancelarEdit').addEventListener('click', cancelEditLead);
  el('btnSalvarEdit').addEventListener('click', saveEditLead);
  el('btnEditar').addEventListener('click', openEditLead);
  el('btnCancelarEdit').addEventListener('click', cancelEditLead);
  el('btnSalvarEdit').addEventListener('click', saveEditLead);

  // Expose modal functions for HTML buttons
  window.fecharModal = fecharModal;
  window.confirmarFechamento = confirmarFechamento;
}


function __hfInit_leads(ctx){

  try {
    if (window.hfPermsReady) await window.hfPermsReady;
    if (window.hfCanRead && !window.hfCanRead('leads')) {
      window.hfRenderNoPermission && window.hfRenderNoPermission({ modulo: 'leads', title: 'Sem permissão', container: document.querySelector('main') });
      return;
    }
  } catch {}
  wireUI();
  hfApplyPermissions();
  wireKanbanDnD();
  await loadLeads();
  hfApplyPermissions();
}

if (window.hfInitPage) window.hfInitPage('leads', __hfInit_leads);
else document.addEventListener('DOMContentLoaded', () => __hfInit_leads({ restore:false }), { once:true });

