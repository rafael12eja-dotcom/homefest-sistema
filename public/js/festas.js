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
  const [y,m,d] = iso.split('-');
  if(!d) return iso;
  return `${d}/${m}/${y}`;
}

let festas = [];
let clientes = [];

async function carregarClientes(){
  const res = await fetch('/api/clientes');
  clientes = res.ok ? await res.json() : [];
  const sel = el('cliente_id');
  sel.innerHTML = clientes.map(c => `<option value="${c.id}">${c.nome} (${c.telefone || 's/ tel'})</option>`).join('');
}

async function carregarFestas(){
  const res = await fetch('/api/eventos');
  festas = res.ok ? await res.json() : [];
  render();
}

function render(){
  const termo = (el('busca').value || '').toLowerCase();
  const st = el('filtroStatus').value;

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
        </div>
      </td>
    </tr>`;
  }).join('');

  el('tbl').querySelector('tbody').innerHTML = rows || `<tr><td colspan="9">Nenhuma festa encontrada.</td></tr>`;
}

function abrirModal(){
  el('modalBackdrop').hidden = false;
  el('modalNova').hidden = false;
}
function fecharModal(){
  el('modalBackdrop').hidden = true;
  el('modalNova').hidden = true;
}

async function criarFesta(){
  const payload = {
    cliente_id: Number(el('cliente_id').value),
    tipo_evento: el('tipo_evento').value,
    data_evento: el('data_evento').value || null,
    convidados: Number(el('convidados').value || 0),
    valor_total: Number(el('valor_total').value || 0),
    status: el('status').value,
    forma_pagamento: el('forma_pagamento').value || null
  };

  const res = await fetch('/api/eventos', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(!res.ok){
    alert('Erro ao criar festa.');
    return;
  }

  fecharModal();
  await carregarFestas();
}

el('btnNova').addEventListener('click', async () => {
  await carregarClientes();
  abrirModal();
});
el('btnCancelar').addEventListener('click', fecharModal);
el('btnFecharModal').addEventListener('click', fecharModal);
el('modalBackdrop').addEventListener('click', fecharModal);
el('btnSalvarNova').addEventListener('click', criarFesta);

el('busca').addEventListener('input', render);
el('filtroStatus').addEventListener('change', render);

carregarFestas();
