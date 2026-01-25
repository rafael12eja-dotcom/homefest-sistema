/*
  Clientes module (Phase 1 / Module 2)
  - List and search customers
  - Create customer
  - View details + linked events
  - Edit customer
  - Quick action: create event for a customer

  All comments in English (per project standards).
*/

function el(id){ return document.getElementById(id); }

function money(v){
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(iso){
  if(!iso) return '—';
  const parts = String(iso).split('-');
  if(parts.length !== 3) return iso;
  const [y,m,d] = parts;
  return `${d}/${m}/${y}`;
}

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

function setHashParam(name, value){
  const params = new URLSearchParams((window.location.hash || '').replace('#',''));
  if(value === null || value === undefined || value === '') params.delete(name);
  else params.set(name, String(value));
  window.location.hash = params.toString();
}

function getHashParam(name){
  const params = new URLSearchParams((window.location.hash || '').replace('#',''));
  return params.get(name);
}

let clientes = [];
let currentCliente = null;

async function apiJson(url, options){
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options && options.headers ? options.headers : {}),
    }
  });
  if(!res.ok){
    const t = await res.text().catch(() => '');
    throw new Error(t || `HTTP ${res.status}`);
  }
  return await res.json();
}

function toggleNovo(show){
  el('novoCard').hidden = !show;
}

function openDrawer(){
  el('drawer').classList.remove('hidden');
  el('drawer').setAttribute('aria-hidden', 'false');
}

function closeDrawer(){
  el('drawer').classList.add('hidden');
  el('drawer').setAttribute('aria-hidden', 'true');
  el('editCard').hidden = true;
  el('btnFecharEditar').hidden = true;
  setHashParam('cliente', '');
  currentCliente = null;
}

function fillCreateForm(data){
  el('c_nome').value = data?.nome || '';
  el('c_telefone').value = data?.telefone || '';
  el('c_email').value = data?.email || '';
  el('c_cidade').value = data?.cidade || '';
  el('c_bairro').value = data?.bairro || '';
  el('c_cep').value = data?.cep || '';
  el('c_endereco').value = data?.endereco || '';
  el('c_numero').value = data?.numero || '';
  el('c_complemento').value = data?.complemento || '';
  el('c_estado').value = data?.estado || '';
  el('c_observacoes').value = data?.observacoes || '';
}

function readCreateForm(){
  return {
    nome: el('c_nome').value,
    telefone: el('c_telefone').value,
    email: el('c_email').value,
    cidade: el('c_cidade').value,
    bairro: el('c_bairro').value,
    cep: el('c_cep').value,
    endereco: el('c_endereco').value,
    numero: el('c_numero').value,
    complemento: el('c_complemento').value,
    estado: el('c_estado').value,
    observacoes: el('c_observacoes').value,
  };
}

function fillEditForm(data){
  el('e_nome').value = data?.nome || '';
  el('e_telefone').value = data?.telefone || '';
  el('e_email').value = data?.email || '';
  el('e_cidade').value = data?.cidade || '';
  el('e_bairro').value = data?.bairro || '';
  el('e_cep').value = data?.cep || '';
  el('e_endereco').value = data?.endereco || '';
  el('e_numero').value = data?.numero || '';
  el('e_complemento').value = data?.complemento || '';
  el('e_estado').value = data?.estado || '';
  el('e_observacoes').value = data?.observacoes || '';
}

function readEditForm(){
  return {
    nome: el('e_nome').value,
    telefone: el('e_telefone').value,
    email: el('e_email').value,
    cidade: el('e_cidade').value,
    bairro: el('e_bairro').value,
    cep: el('e_cep').value,
    endereco: el('e_endereco').value,
    numero: el('e_numero').value,
    complemento: el('e_complemento').value,
    estado: el('e_estado').value,
    observacoes: el('e_observacoes').value,
  };
}

function renderTable(){
  const q = (el('q').value || '').toLowerCase();
  const rows = clientes.filter(c => {
    const hay = `${c.nome||''} ${c.telefone||''} ${c.email||''} ${c.cidade||''} ${c.bairro||''}`.toLowerCase();
    return !q || hay.includes(q);
  }).map(c => {
    const last = c.ultimo_evento_data ? fmtDate(c.ultimo_evento_data) : '—';
    const festas = Number(c.total_eventos || 0);
    return `
      <tr>
        <td>${c.nome || ''}</td>
        <td>${c.telefone || ''}</td>
        <td>${c.cidade || ''}</td>
        <td>${c.bairro || ''}</td>
        <td><span class="pill small">${festas}</span></td>
        <td>${last}</td>
        <td>
          <button class="btn-ghost btn-sm" data-ver="${c.id}">Ver</button>
        </td>
      </tr>
    `;
  }).join('');

  el('clientesLista').innerHTML = rows || `<tr><td colspan="7">Nenhum cliente encontrado.</td></tr>`;
  el('count').textContent = String(clientes.length);
}

async function carregarClientes(){
  clientes = await apiJson('/api/clientes');
  renderTable();
}

function renderDrawer(cliente, eventos){
  currentCliente = cliente;

  el('d_nome').textContent = cliente.nome || 'Cliente';
  const sub = [cliente.cidade, cliente.bairro].filter(Boolean).join(' · ');
  el('d_sub').textContent = sub || '—';
  el('d_tel').textContent = cliente.telefone || '—';
  el('d_email').textContent = cliente.email || '—';

  const local = [cliente.cidade, cliente.bairro].filter(Boolean).join(' — ');
  el('d_local').textContent = local || '—';

  const end = [cliente.endereco, cliente.numero, cliente.complemento, cliente.cep, cliente.estado].filter(Boolean).join(', ');
  el('d_end').textContent = end || '—';

  const evRows = (eventos || []).map(e => {
    return `
      <tr>
        <td>${fmtDate(e.data_evento)}</td>
        <td>${e.tipo_evento || '—'}</td>
        <td>${badge(e.status)}</td>
        <td>${money(e.valor_total)}</td>
        <td>${e.contrato_numero || '—'}</td>
        <td><a class="btn-sm primary" href="/app/festa.html?id=${e.id}">Abrir</a></td>
      </tr>
    `;
  }).join('');

  el('d_eventos').innerHTML = evRows || `<tr><td colspan="6">Nenhuma festa vinculada.</td></tr>`;
  el('d_eventos_count').textContent = String((eventos || []).length);

  // Quick actions
  el('btnCriarFesta').setAttribute('href', `/app/festas.html?action=create&cliente_id=${cliente.id}`);
}

async function verCliente(id){
  const data = await apiJson('/api/clientes/' + id);
  renderDrawer(data.cliente, data.eventos);
  setHashParam('cliente', id);
  openDrawer();
}

async function criarCliente(){
  const payload = readCreateForm();
  if(!String(payload.nome || '').trim()){
    alert('Informe o nome do cliente.');
    return;
  }
  await apiJson('/api/clientes', { method: 'POST', body: JSON.stringify(payload) });
  toggleNovo(false);
  fillCreateForm(null);
  await carregarClientes();
}

async function salvarEdicao(){
  if(!currentCliente?.id) return;
  const payload = readEditForm();
  if(!String(payload.nome || '').trim()){
    alert('Informe o nome do cliente.');
    return;
  }
  const data = await apiJson('/api/clientes/' + currentCliente.id, { method: 'PUT', body: JSON.stringify(payload) });
  currentCliente = data.cliente;
  // refresh list (keeps search)
  await carregarClientes();
  // refresh drawer
  const full = await apiJson('/api/clientes/' + currentCliente.id);
  renderDrawer(full.cliente, full.eventos);
  el('editCard').hidden = true;
  el('btnFecharEditar').hidden = true;
}

function abrirEdicao(){
  if(!currentCliente) return;
  fillEditForm(currentCliente);
  el('editCard').hidden = false;
  el('btnFecharEditar').hidden = false;
  el('btnEditar').hidden = true;
}

function fecharEdicao(){
  el('editCard').hidden = true;
  el('btnFecharEditar').hidden = true;
  el('btnEditar').hidden = false;
}

function bind(){
  el('btnNovo').addEventListener('click', () => {
    toggleNovo(!el('novoCard').hidden);
  });
  el('btnCancelarNovo').addEventListener('click', () => {
    toggleNovo(false);
  });
  el('btnSalvarNovo').addEventListener('click', criarCliente);

  el('q').addEventListener('input', renderTable);

  el('clientesLista').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-ver]');
    if(!btn) return;
    const id = Number(btn.getAttribute('data-ver'));
    if(id) verCliente(id);
  });

  el('btnFecharDrawer').addEventListener('click', closeDrawer);
  el('drawerBackdrop').addEventListener('click', closeDrawer);

  el('btnEditar').addEventListener('click', abrirEdicao);
  el('btnFecharEditar').addEventListener('click', fecharEdicao);
  el('btnCancelarEdicao').addEventListener('click', fecharEdicao);
  el('btnSalvarEdicao').addEventListener('click', salvarEdicao);
}

(async function init(){
  bind();
  await carregarClientes();

  // Deep link support: /app/clientes.html#cliente=123
  const id = getHashParam('cliente');
  if(id){
    const n = Number(id);
    if(Number.isFinite(n) && n > 0){
      try { await verCliente(n); } catch { /* ignore */ }
    }
  }
})();
