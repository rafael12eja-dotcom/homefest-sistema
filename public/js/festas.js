function el(id){ return document.getElementById(id); }

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

async function carregarClientes(){
  const res = await fetch('/api/clientes');
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  clientes = res.ok ? await res.json() : [];
  const sel = el('cliente_id');
  if (!sel) return;

  if (!clientes.length) {
    sel.innerHTML = `<option value="">Nenhum cliente cadastrado</option>`;
    setSaveEnabled(false, 'Crie um cliente primeiro');
    return;
  }

  sel.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nome} (${c.telefone || 's/ tel'})</option>`).join('');
  setSaveEnabled(true);
}

async function carregarFestas(){
  const res = await fetch('/api/eventos');
  festas = res.ok ? await res.json() : [];
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
          <a class="btn-sm primary" href="/app/festa.html?id=${f.id}">Abrir</a>
          <button class="btn-sm" data-action="edit" data-id="${f.id}" title="Editar">Editar</button>
          <button class="btn-sm danger" data-action="del" data-id="${f.id}" title="Excluir">Excluir</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows || `<tr><td colspan="9">Nenhuma festa encontrada.</td></tr>`;
}

function abrirModal(mode){
  el('modalBackdrop').hidden = false;
  el('modalNova').hidden = false;
  const title = el('modalTitle');
  if (title) title.textContent = mode === 'edit' ? 'Editar Festa' : 'Nova Festa';
  const btn = el('btnSalvarNova');
  if (btn) btn.textContent = mode === 'edit' ? 'Salvar alterações' : 'Criar festa';
}
function fecharModal(){
  el('modalBackdrop').hidden = true;
  el('modalNova').hidden = true;
  editId = null;
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

  const res = await fetch(url, {
    method,
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(!res.ok){
    const txt = await res.text().catch(()=>'');
    alert('Erro ao salvar festa. ' + txt);
    return;
  }

  fecharModal();
  await carregarFestas();
  toast(editId ? 'Festa atualizada.' : 'Festa criada.');
}

async function criarClienteRapido(){
  const nome = (el('qc_nome')?.value || '').trim();
  const telefone = (el('qc_telefone')?.value || '').trim();
  if (!nome) {
    toast('Informe o nome do cliente.');
    el('qc_nome')?.focus();
    return;
  }

  const res = await fetch('/api/clientes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome, telefone })
  });

  if (!res.ok) {
    const txt = await res.text().catch(()=>'');
    alert('Erro ao criar cliente. ' + txt);
    return;
  }

  const data = await res.json().catch(()=>null);
  await carregarClientes();
  if (data?.id) {
    el('cliente_id').value = String(data.id);
  }
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
  toast('Festa excluída.');
}

async function abrirCriacao(preselectClienteId){
  await carregarClientes();
  clearForm();
  if (preselectClienteId) {
    const sel = el('cliente_id');
    if (sel) sel.value = String(preselectClienteId);
  }
  showQuickCliente(false);
  abrirModal('create');
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

function init(){
  // Guard against partial/legacy DOM variants. Never let one missing element break the whole page.
  el('btnNova')?.addEventListener('click', () => abrirCriacao(null));
  el('btnCancelar')?.addEventListener('click', fecharModal);
  el('btnFecharModal')?.addEventListener('click', fecharModal);
  el('modalBackdrop')?.addEventListener('click', fecharModal);
  el('btnSalvarNova')?.addEventListener('click', salvarFesta);

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

  // Boot
  carregarFestas();

  // Auto-open create modal when coming from dashboard/client drawer.
  // Examples:
  //  /app/festas.html?action=create
  //  /app/festas?action=create
  //  /app/festas.html?action=create&cliente_id=123
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'create') {
      const cid = params.get('cliente_id');
      abrirCriacao(cid);
    }
  } catch {
    // no-op
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
