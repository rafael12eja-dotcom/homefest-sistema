function __hfInit_festas(ctx){
function el(id){ return document.getElementById(id); }

function hfApplyPermissions(){ try { if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document); } catch {} }


// Basic HTML/attribute escaping to avoid breaking option labels.
function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(s){ return escapeHtml(s).replaceAll('\n', ' '); }

function statusLabel(st){
  switch(st){
    case 'orcamento': return 'Orçamento';
    case 'confirmado': return 'Confirmado';
    case 'fechado': return 'Fechado';
    case 'em_producao': return 'Em produção';
    case 'realizado': return 'Realizado';
    case 'finalizado': return 'Finalizado';
    case 'cancelado': return 'Cancelado';
    default: return st || '—';
  }
}

function badge(st){
  const lbl = statusLabel(st);
  const cls = (st === 'confirmado' || st === 'fechado') ? 'badge gold' : 'badge';
  return `<span class="${cls}">${lbl}</span>`;
}

function money(v){
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function fmtDate(iso){
  if(!iso) return '—';
  const [y,m,d] = String(iso).split('-');
  if(!d) return iso;
  return `${d}/${m}/${y}`;
}

function toast(msg){
  // Minimal feedback without noisy alerts.
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);
  }, 2600);
}

let festas = [];
let clientes = [];
let editId = null;

function setCreateUrl(action){
  try {
    const url = new URL(window.location.href);
    if (action) url.searchParams.set('action', action);
    else url.searchParams.delete('action');
    // Keep other params (e.g., cliente_id) intact unless action is removed.
    if (!action) url.searchParams.delete('cliente_id');
    window.history.replaceState({}, '', url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : ''));
  } catch {
    // no-op
  }
}

function enterCreateMode(mode){
  document.body.classList.add('is-creating');
  const topBtn = el('btnNova');
  if (topBtn) {
    topBtn.textContent = 'Voltar';
    topBtn.href = '/app/festas';
  }
  const panel = el('createPanel');
  if (panel) panel.hidden = false;
  const title = el('modalTitle');
  if (title) title.textContent = mode === 'edit' ? 'Editar Festa' : 'Nova Festa';
  const btn = el('btnSalvarNova');
  if (btn) btn.textContent = mode === 'edit' ? 'Salvar alterações' : 'Criar festa';
  // Keep the primary CTA visible at the top of the screen flow.
  panel?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function exitCreateMode(){
  document.body.classList.remove('is-creating');
  const topBtn = el('btnNova');
  if (topBtn) {
    topBtn.textContent = '+ Nova festa';
    topBtn.href = '/app/festas?action=create';
  }
  const panel = el('createPanel');
  if (panel) panel.hidden = true;
  showQuickCliente(false);
  editId = null;
  setCreateUrl(null);
}

function setSaveEnabled(enabled, reason){
  const btn = el('btnSalvarNova');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled ? '' : (reason || 'Em desenvolvimento');
}

function showQuickCliente(show){
  const box = el('quickClienteBox');
  if (!box) return;
  box.hidden = !show;
}


function ensureConvidadosOptions(){
  const sel = el('convidados');
  if (!sel || sel.tagName !== 'SELECT') return;
  if (sel.dataset.ready === '1') return;
  sel.innerHTML = '<option value="">Selecione</option>';
  for (let i = 10; i <= 500; i += 10) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    sel.appendChild(opt);
  }
  sel.dataset.ready = '1';
}

async function carregarClientes(){
  // IMPORTANTE: window.apiJson já faz parse do JSON e trata 401/403.
  // /api/clientes (legacy) retorna um ARRAY direto.
  let data;
  try {
    data = await window.hfApiJson('/api/clientes', { cache: 'no-store' });
  } catch (err) {
    toast('Falha ao carregar clientes.');
    clientes = [];
    return;
  }
  clientes = Array.isArray(data) ? data : (data?.items || []);
  const sel = el('cliente_id');
  if (!sel) return;

  if (!clientes.length) {
    sel.innerHTML = `<option value="">Nenhum cliente cadastrado</option>`;
    setSaveEnabled(false, 'Crie um cliente primeiro');
    return;
  }

  sel.innerHTML = clientes.map(c => {
    const nome = escapeHtml(c.nome || '');
    const tel = c.telefone ? String(c.telefone) : '';
    const title = tel ? ` title="${escapeAttr(tel)}"` : '';
    return `<option value="${c.id}"${title}>${nome}</option>`;
  }).join('');
  setSaveEnabled(true);
}

async function carregarFestas(){
  let data;
  try {
    data = await window.hfApiJson('/api/eventos', { cache: 'no-store' });
  } catch (err) {
    toast('Falha ao carregar festas.');
    festas = [];
    render();
    return;
  }
  // /api/eventos retorna um ARRAY direto.
  festas = Array.isArray(data) ? data : (data?.items || []);
  render();
}

function render(){
  const termo = (el('busca').value || '').toLowerCase();
  const st = el('filtroStatus').value;

  const tbody = el('tbl').querySelector('tbody');

  const rows = festas.filter(f => {
    const hay = `${f.cliente_nome||''} ${f.tipo_evento||''} ${f.contrato_numero||''}`.toLowerCase();
    const okTermo = !termo || hay.includes(termo);
    const okSt = !st || (f.status === st);
    return okTermo && okSt;
  }).map(f => {
    return `<tr>
      <td>${f.id}</td>
      <td>${f.cliente_nome || '—'}</td>
      <td>${f.tipo_evento || '—'}</td>
      <td>${fmtDate(f.data_evento)}</td>
      <td>${f.convidados ?? 0}</td>
      <td>${money(f.valor_total)}</td>
      <td>${badge(f.status)}</td>
      <td>${f.contrato_numero || '—'}</td>
      <td>
        <div class="actions">
          <a class="btn-sm primary" href="/app/festa?id=${f.id}">Abrir</a>
          <button class="btn-sm" data-action="edit" data-id="${f.id}" title="Editar">Editar</button>
          <button class="btn-sm danger" data-action="del" data-id="${f.id}" title="Excluir">Excluir</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows || `<tr><td colspan="9">Nenhuma festa encontrada.</td></tr>`;
}

// Backward compatible function names (older builds used a modal).
// Now we use a full-page create panel and normal page scroll.
function abrirModal(mode){
  enterCreateMode(mode);
}
function fecharModal(){
  exitCreateMode();
}

function clearForm(){
  el('tipo_evento').value = 'Infantil';
  el('data_evento').value = '';
  el('convidados').value = '';
  el('valor_total').value = '';
  el('status').value = 'orcamento';
  el('forma_pagamento').value = '';
  const cn = el('contrato_numero');
  if (cn) cn.value = '';
}

function fillForm(f){
  if (!f) return;
  el('cliente_id').value = String(f.cliente_id ?? el('cliente_id').value);
  el('tipo_evento').value = f.tipo_evento || 'Outro';
  el('data_evento').value = f.data_evento || '';
  el('convidados').value = Number(f.convidados || 0);
  el('valor_total').value = Number(f.valor_total || 0);
  el('status').value = f.status || 'orcamento';
  el('forma_pagamento').value = f.forma_pagamento || '';
  const cn = el('contrato_numero');
  if (cn) cn.value = f.contrato_numero || '';
}

async function salvarFesta(){
  const clienteVal = String(el('cliente_id').value || '').trim();
  if (!clienteVal) {
    toast('Selecione um cliente (ou crie um cliente rápido).');
    showQuickCliente(true);
    return;
  }

  const payload = {
    cliente_id: Number(clienteVal),
    tipo_evento: el('tipo_evento').value,
    data_evento: el('data_evento').value || null,
    convidados: Number(el('convidados').value || 0),
    valor_total: Number(el('valor_total').value || 0),
    status: el('status').value,
    forma_pagamento: el('forma_pagamento').value || null,
    contrato_numero: (el('contrato_numero')?.value || '').trim() || null
  };

  const url = editId ? `/api/eventos/${editId}` : '/api/eventos';
  const method = editId ? 'PATCH' : 'POST';

  let out;
  try {
    out = await window.hfApiJson(url, {
      method,
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
  } catch (err) {
    toast('Erro ao salvar festa.');
    return;
  }

  if (!out || out.ok !== true) {
    toast(out?.error ? String(out.error) : 'Erro ao salvar festa.');
    return;
  }

  fecharModal();
  await carregarFestas();
  hfApplyPermissions();
  toast(editId ? 'Festa atualizada.' : 'Festa criada.');

  // Redirect to event central on create for a coherent flow.
  if (!editId) {
    const newId = out?.id || out?.evento_id || out?.evento?.id;
    if (newId) {
      window.location.href = `/app/festa?id=${newId}`;
    }
  }
}

async function criarClienteRapido(){
  const nome = (el('qc_nome')?.value || '').trim();
  const telefone = (el('qc_telefone')?.value || '').trim();
  if (!nome) {
    toast('Informe o nome do cliente.');
    el('qc_nome')?.focus();
    return;
  }
  if (!telefone) {
    toast('Informe o telefone do cliente.');
    el('qc_telefone')?.focus();
    return;
  }

  let out;
  try {
    out = await window.hfApiJson('/api/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Quick create: mínimo viável (nome + telefone, email opcional)
    body: JSON.stringify({
      nome,
      telefone,
      email: (el('qc_email')?.value || '').trim() || null
    })
    });
  } catch (err) {
    // window.apiJson já exibiu toast para 403 e redirecionou no 401.
    toast('Não foi possível criar o cliente.');
    return;
  }

  if (!out || out.ok !== true) {
    toast(out?.error ? String(out.error) : 'Erro ao criar cliente.');
    return;
  }

  await carregarClientes();
  if (out?.id) el('cliente_id').value = String(out.id);
  showQuickCliente(false);
  toast('Cliente criado.');
}

async function excluirFesta(id){
  const ok = confirm('Tem certeza que deseja excluir esta festa?');
  if(!ok) return;

  const res = await fetch(`/api/eventos/${id}`, { method: 'DELETE' });
  if(!res.ok){
    alert('Erro ao excluir festa.');
    return;
  }
  await carregarFestas();
  hfApplyPermissions();
  toast('Festa excluída.');
}

async function abrirCriacao(preselectClienteId){
  ensureConvidadosOptions();
  // Open create panel immediately for instant feedback.
  clearForm();
  showQuickCliente(false);
  setCreateUrl('create');
  abrirModal('create');

  const sel = el('cliente_id');
  if (sel) {
    sel.innerHTML = '<option value="">Carregando clientes...</option>';
  }
  setSaveEnabled(false, 'Carregando clientes...');

  await carregarClientes();
  if (preselectClienteId) {
    if (sel) sel.value = String(preselectClienteId);
  }
}

async function abrirEdicao(id){
  await carregarClientes();
  const res = await fetch(`/api/eventos/${id}`);
  if(!res.ok){
    alert('Erro ao carregar festa para edição.');
    return;
  }
  const data = await res.json();
  editId = id;
  fillForm(data.evento);
  abrirModal('edit');
}

async function init(){
  try {
    if (window.hfPermsReady) await window.hfPermsReady;
    if (window.hfCanRead && !window.hfCanRead('eventos')) {
      window.hfRenderNoPermission && window.hfRenderNoPermission({ modulo: 'eventos', title: 'Sem permissão', container: document.querySelector('main') });
      return;
    }
  } catch {}

  // Guard against partial/legacy DOM variants. Never let one missing element break the whole page.
  el('btnNova')?.addEventListener('click', (ev) => {
    // btnNova is an <a> for fallback routing. When JS is alive, keep SPA-like modal.
    ev.preventDefault();
    abrirCriacao(null).catch(() => toast('Erro ao abrir criação de festa.'));
  });
  el('btnCancelar')?.addEventListener('click', fecharModal);
  el('btnFecharModal')?.addEventListener('click', fecharModal);
  el('btnSalvarNova')?.addEventListener('click', () => {
    salvarFesta().catch(() => toast('Erro ao salvar festa.'));
  });

  // Quick client creation
  el('btnQuickCliente')?.addEventListener('click', () => {
    showQuickCliente(true);
    el('qc_nome')?.focus();
  });
  el('btnCloseQuickCliente')?.addEventListener('click', () => showQuickCliente(false));
  el('btnCancelQuickCliente')?.addEventListener('click', () => showQuickCliente(false));
  el('btnSaveQuickCliente')?.addEventListener('click', criarClienteRapido);

  el('busca')?.addEventListener('input', render);
  el('filtroStatus')?.addEventListener('change', render);

  el('tbl')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('button[data-action]');
    if(!btn) return;
    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    if(action === 'edit') abrirEdicao(id);
    if(action === 'del') excluirFesta(id);
  });

  ensureConvidadosOptions();

  // Boot
  carregarFestas().catch(() => toast('Erro ao iniciar lista de festas.'));

  // Auto-open create modal when coming from dashboard/client drawer.
  // Examples:
  //  /app/festas?action=create
  //  /app/festas?action=create
  //  /app/festas?action=create&cliente_id=123
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') {
      const cid = params.get('cliente_id');
      abrirCriacao(cid).catch(() => toast('Erro ao abrir criação de festa.'));
    }
  } catch {
    // no-op
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch(() => toast('Erro ao iniciar a página.')));
} else {
  init().catch(() => toast('Erro ao iniciar a página.'));
}

}

if (window.hfInitPage) window.hfInitPage('festas', __hfInit_festas);
else document.addEventListener('DOMContentLoaded', () => __hfInit_festas({ restore:false }), { once:true });
