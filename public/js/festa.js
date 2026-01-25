function qs(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function money(v){
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}

function formatDateISO(iso){
  if(!iso) return '—';
  const [y,m,d] = iso.split('-');
  if(!d) return iso;
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

let evento = null;

async function carregar(){
  const id = qs('id');
  if(!id){
    document.getElementById('subtitulo').textContent = 'Festa não encontrada (sem id).';
    return;
  }

  const res = await fetch('/api/eventos/' + id);
  if(!res.ok){
    document.getElementById('subtitulo').textContent = 'Erro ao carregar a festa.';
    return;
  }

  const data = await res.json();
  evento = data.evento;

  // resumo
  document.getElementById('clienteNome').textContent = data.cliente?.nome || '—';
  const tel = data.cliente?.telefone || '';
  const aTel = document.getElementById('clienteTelefone');
  if(tel){
    const only = tel.replace(/\D/g,'');
    aTel.textContent = tel;
    aTel.href = `https://wa.me/55${only}`;
  } else {
    aTel.textContent = '—';
    aTel.href = '#';
  }

  document.getElementById('eventoData').textContent = formatDateISO(evento.data_evento);
  document.getElementById('eventoConvidados').textContent = String(evento.convidados || 0);
  document.getElementById('eventoValor').textContent = money(evento.valor_total || 0);
  document.getElementById('eventoPagamento').textContent = evento.forma_pagamento || '—';

  const subt = `#${evento.id} • ${evento.tipo_evento || 'Festa'} • ${statusLabel(evento.status)}`;
  document.getElementById('subtitulo').textContent = subt;

  document.getElementById('badgeStatus').textContent = statusLabel(evento.status);
  document.getElementById('badgeContrato').textContent = evento.contrato_numero ? evento.contrato_numero : 'Sem nº contrato';

  // form
  document.getElementById('tipo_evento').value = evento.tipo_evento || 'Outro';
  document.getElementById('data_evento').value = evento.data_evento || '';
  document.getElementById('convidados').value = evento.convidados || 0;
  document.getElementById('valor_total').value = evento.valor_total || 0;
  document.getElementById('status').value = evento.status || 'orcamento';
  document.getElementById('forma_pagamento').value = evento.forma_pagamento || '';
}

async function salvar(){
  const id = qs('id');
  if(!id) return;

  const payload = {
    tipo_evento: document.getElementById('tipo_evento').value,
    data_evento: document.getElementById('data_evento').value || null,
    convidados: Number(document.getElementById('convidados').value || 0),
    valor_total: Number(document.getElementById('valor_total').value || 0),
    status: document.getElementById('status').value,
    forma_pagamento: document.getElementById('forma_pagamento').value || null
  };

  const res = await fetch('/api/eventos/' + id, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(!res.ok){
    alert('Erro ao salvar.');
    return;
  }

  await carregar();
  alert('Salvo ✅');
}

document.getElementById('btnSalvar')?.addEventListener('click', salvar);


// Tabs + módulos
let activeTab = 'equipe';

function setActiveTab(tab){
  activeTab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.module').forEach(m => {
    const show = m.dataset.module === tab;
    m.hidden = !show;
  });
  if(tab === 'equipe') carregarEquipe();
  if(tab === 'proposta') carregarPropostas();
}

// ---------- Helpers (BRL) ----------
function parseBRL(str){
  if(str === null || str === undefined) return 0;
  if(typeof str === 'number') return str;
  const s = String(str).trim();
  if(!s) return 0;
  // remove currency and spaces
  const clean = s.replace(/[R$\s]/g,'').replace(/\./g,'').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}
function formatBRLInput(n){
  const v = Number(n || 0);
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Equipe ----------
let equipeEditId = null;

function equipeRowHTML(it){
  const qtd = Number(it.quantidade || 0);
  const vu = Number(it.valor_unitario || 0);
  const vt = Number(it.valor_total || (qtd*vu) || 0);
  return `
    <tr data-id="${it.id}">
      <td>${it.item || '—'}</td>
      <td>${it.fornecedor || '—'}</td>
      <td class="num">${qtd}</td>
      <td>${it.unidade || '—'}</td>
      <td class="num">${money(vu)}</td>
      <td class="num"><strong>${money(vt)}</strong></td>
      <td><span class="badge st-${(it.status||'pendente').toLowerCase()}">${it.status || 'pendente'}</span></td>
      <td class="actions">
        <button class="btn-mini" data-act="edit">Editar</button>
        <button class="btn-mini danger" data-act="del">Excluir</button>
      </td>
    </tr>
  `;
}

async function carregarEquipe(){
  const eventoId = qs('id');
  const tbody = document.getElementById('equipeTbody');
  if(!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Carregando…</td></tr>`;

  const res = await fetch(`/api/eventos-itens?evento_id=${encodeURIComponent(eventoId)}&categoria=equipe`);
  if(!res.ok){
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Erro ao carregar equipe.</td></tr>`;
    return;
  }
  const items = await res.json();

  if(!items.length){
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">Nenhum item de equipe ainda. Clique em <strong>Adicionar</strong>.</td></tr>`;
  }else{
    tbody.innerHTML = items.map(equipeRowHTML).join('');
  }

  const total = items.reduce((acc,it)=> acc + Number(it.valor_total || 0), 0);
  const totalEl = document.getElementById('equipeTotal');
  if(totalEl) totalEl.textContent = money(total);
}

function abrirModalEquipe(mode, data){
  equipeEditId = (mode === 'edit') ? data.id : null;

  const modal = document.getElementById('modalEquipe');
  if(!modal) return;

  document.getElementById('modalEquipeTitle').textContent = (mode === 'edit') ? 'Editar equipe' : 'Adicionar equipe';

  const funcSel = document.getElementById('eqFuncao');
  const funcOutro = document.getElementById('eqFuncaoOutro');

  const item = data?.item || '';
  const known = Array.from(funcSel.options).map(o=>o.value || o.text).filter(Boolean);
  if(mode === 'edit' && item && !known.includes(item)) {
    funcSel.value = 'Outro';
    funcOutro.hidden = false;
    funcOutro.value = item;
  } else {
    funcSel.value = item || '';
    funcOutro.hidden = (funcSel.value !== 'Outro');
    funcOutro.value = '';
  }

  document.getElementById('eqFornecedor').value = data?.fornecedor || '';
  document.getElementById('eqQtd').value = Number(data?.quantidade ?? 1);
  document.getElementById('eqUnidade').value = data?.unidade || 'pessoa';
  document.getElementById('eqValorUnit').value = formatBRLInput(Number(data?.valor_unitario || 0));
  document.getElementById('eqValorTotal').value = data?.valor_total ? formatBRLInput(Number(data?.valor_total)) : '';
  document.getElementById('eqStatus').value = (data?.status || 'pendente');
  document.getElementById('eqObs').value = data?.observacao || '';

  modal.hidden = false;
}

function fecharModalEquipe(){
  const modal = document.getElementById('modalEquipe');
  if(modal) modal.hidden = true;
}

function getEquipePayload(){
  const funcSel = document.getElementById('eqFuncao');
  const funcOutro = document.getElementById('eqFuncaoOutro');
  let item = funcSel.value;
  if(item === 'Outro') item = (funcOutro.value || '').trim();

  const qtd = Number(document.getElementById('eqQtd').value || 0);
  const unidade = document.getElementById('eqUnidade').value;
  const fornecedor = (document.getElementById('eqFornecedor').value || '').trim();
  const vu = parseBRL(document.getElementById('eqValorUnit').value);
  const vtStr = (document.getElementById('eqValorTotal').value || '').trim();
  const vt = vtStr ? parseBRL(vtStr) : undefined;
  const status = document.getElementById('eqStatus').value;
  const observacao = (document.getElementById('eqObs').value || '').trim();

  return { item, quantidade: qtd, unidade, fornecedor, valor_unitario: vu, valor_total: vt, status, observacao };
}

async function salvarEquipe(){
  const eventoId = qs('id');
  const payload = getEquipePayload();

  if(!payload.item){
    alert('Informe a função (item).');
    return;
  }

  const body = {
    evento_id: Number(eventoId),
    categoria: 'equipe',
    ...payload
  };

  let res;
  if(equipeEditId){
    // PATCH /api/eventos-itens/:id
    res = await fetch(`/api/eventos-itens/${equipeEditId}`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
  }else{
    res = await fetch(`/api/eventos-itens`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body)
    });
  }

  if(!res.ok){
    const t = await res.text().catch(()=> '');
    alert('Erro ao salvar equipe. ' + t);
    return;
  }

  fecharModalEquipe();
  await carregarEquipe();
}

async function excluirEquipe(id){
  if(!confirm('Excluir este item de equipe?')) return;
  const res = await fetch(`/api/eventos-itens/${id}`, { method:'DELETE' });
  if(!res.ok){
    alert('Erro ao excluir.');
    return;
  }
  await carregarEquipe();
}

// Eventos UI Equipe
document.getElementById('btnEquipeNovo')?.addEventListener('click', () => abrirModalEquipe('new', null));
document.getElementById('btnEquipeFechar')?.addEventListener('click', fecharModalEquipe);
document.getElementById('btnEquipeCancelar')?.addEventListener('click', fecharModalEquipe);
document.getElementById('btnEquipeSalvar')?.addEventListener('click', salvarEquipe);

document.getElementById('modalEquipe')?.addEventListener('click', (e) => {
  const t = e.target;
  if(t?.dataset?.close === '1') fecharModalEquipe();
});

document.getElementById('eqFuncao')?.addEventListener('change', (e) => {
  const outro = document.getElementById('eqFuncaoOutro');
  outro.hidden = (e.target.value !== 'Outro');
});

function wireAutoCalc(){
  const qtdEl = document.getElementById('eqQtd');
  const vuEl = document.getElementById('eqValorUnit');
  const vtEl = document.getElementById('eqValorTotal');

  function recalc(){
    const qtd = Number(qtdEl.value || 0);
    const vu = parseBRL(vuEl.value);
    if(!vtEl.value.trim()){
      // não sobrescreve se usuário digitou total manualmente
      return;
    }
  }

  // máscara simples BRL
  function onMoneyInput(el){
    el.addEventListener('blur', () => {
      const n = parseBRL(el.value);
      el.value = el.value.trim() ? formatBRLInput(n) : '';
    });
  }

  onMoneyInput(vuEl);
  onMoneyInput(vtEl);

  qtdEl.addEventListener('input', () => {
    if(!vtEl.value.trim()){
      // nada
      return;
    }
  });
}
wireAutoCalc();

// clique ações tabela
document.getElementById('equipeTbody')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if(!btn) return;
  const tr = e.target.closest('tr');
  const id = tr?.dataset?.id;
  if(!id) return;

  const act = btn.dataset.act;
  if(act === 'del') return excluirEquipe(id);

  if(act === 'edit'){
    // carrega dados do item via lista atual (sem nova chamada)
    const tds = tr.querySelectorAll('td');
    const item = tds[0].textContent.trim();
    const fornecedor = tds[1].textContent.trim();
    const qtd = Number(tds[2].textContent.trim() || 0);
    const unidade = tds[3].textContent.trim();
    // para editar com precisão, buscamos o item no backend (garante valor_unitario e valor_total exatos)
    const eventoId = qs('id');
    const res = await fetch(`/api/eventos-itens?evento_id=${encodeURIComponent(eventoId)}&categoria=equipe`);
    if(res.ok){
      const items = await res.json();
      const found = items.find(x => String(x.id) === String(id));
      if(found) abrirModalEquipe('edit', found);
      else abrirModalEquipe('edit', { id, item, fornecedor, quantidade:qtd, unidade });
    }else{
      abrirModalEquipe('edit', { id, item, fornecedor, quantidade:qtd, unidade });
    }
  }
});


// ===== Proposals (Module 4) =====
let propItems = [];
let propLastId = null;

function parseMoneyInput(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).trim();
  if(!s) return 0;
  const normalized = s.replace(/\./g,'').replace(',', '.').replace(/[^0-9.\-]/g,'');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

function calcPropTotals(){
  const subtotal = propItems.reduce((acc, it) => acc + (Number(it.qtd||0) * Number(it.unit||0)), 0);
  const desconto = parseMoneyInput(document.getElementById('propDesconto')?.value || 0);
  const total = Math.max(0, subtotal - desconto);
  return { subtotal, desconto, total };
}

function renderPropItems(){
  const tbody = document.getElementById('propItens');
  const empty = document.getElementById('propEmpty');
  if(!tbody) return;

  tbody.innerHTML = '';
  if(propItems.length === 0){
    if(empty) empty.style.display = 'block';
  }else{
    if(empty) empty.style.display = 'none';
  }

  propItems.forEach((it, idx) => {
    const tr = document.createElement('tr');
    const safeDesc = String(it.desc || '').replaceAll('"','&quot;');
    tr.innerHTML = `
      <td>${idx+1}</td>
      <td><input class="in" data-k="desc" data-i="${idx}" type="text" placeholder="Descrição" value="${safeDesc}"></td>
      <td style="text-align:right;"><input class="in num" data-k="qtd" data-i="${idx}" type="number" min="0" step="1" value="${Number(it.qtd||0)}"></td>
      <td style="text-align:right;"><input class="in num" data-k="unit" data-i="${idx}" type="number" min="0" step="0.01" value="${Number(it.unit||0)}"></td>
      <td style="text-align:center;"><button class="icon-btn" data-remove="${idx}" title="Remover">✕</button></td>
    `;
    tbody.appendChild(tr);
  });

  const totals = calcPropTotals();
  const elSub = document.getElementById('propSubtotal');
  const elTot = document.getElementById('propTotal');
  if(elSub) elSub.textContent = money(totals.subtotal);
  if(elTot) elTot.textContent = money(totals.total);
}

function bindPropostaUI(){
  const add = document.getElementById('btnPropAdicionar');
  const save = document.getElementById('btnPropSalvar');
  const desc = document.getElementById('propDesconto');

  if(add && !add.dataset.bound){
    add.dataset.bound = '1';
    add.addEventListener('click', () => {
      propItems.push({ desc:'', qtd: 1, unit: 0 });
      renderPropItems();
    });
  }

  if(desc && !desc.dataset.bound){
    desc.dataset.bound = '1';
    desc.addEventListener('input', renderPropItems);
  }

  const tbody = document.getElementById('propItens');
  if(tbody && !tbody.dataset.bound){
    tbody.dataset.bound='1';
    tbody.addEventListener('input', (e) => {
      const t = e.target;
      if(!(t instanceof HTMLInputElement)) return;
      const i = Number(t.dataset.i);
      const k = t.dataset.k;
      if(!Number.isFinite(i) || !propItems[i]) return;
      if(k === 'qtd' || k === 'unit'){
        propItems[i][k] = Number(t.value || 0);
      }else{
        propItems[i][k] = t.value;
      }
      renderPropItems();
    });
    tbody.addEventListener('click', (e) => {
      const el = e.target;
      if(!(el instanceof HTMLElement)) return;
      const r = el.getAttribute('data-remove');
      if(r === null) return;
      const idx = Number(r);
      if(!Number.isFinite(idx)) return;
      propItems.splice(idx, 1);
      renderPropItems();
    });
  }

  if(save && !save.dataset.bound){
    save.dataset.bound='1';
    save.addEventListener('click', async () => {
      const id = qs('id');
      if(!id) return;
      if(propItems.length === 0){
        alert('Adicione pelo menos 1 item na proposta.');
        return;
      }
      const titulo = (document.getElementById('propTitulo')?.value || 'Proposta Comercial').trim();
      const validade = (document.getElementById('propValidade')?.value || '').trim();
      const condicoes = (document.getElementById('propCondicoes')?.value || '').trim();
      const observacoes = (document.getElementById('propObs')?.value || '').trim();
      const desconto = parseMoneyInput(document.getElementById('propDesconto')?.value || 0);

      const items = propItems
        .map(it => ({ desc: String(it.desc || '').trim(), qtd: Number(it.qtd || 0), unit: Number(it.unit || 0) }))
        .filter(it => it.desc);

      const res = await fetch(`/api/eventos/${id}/propostas`, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ titulo, validade, condicoes, observacoes, desconto, items })
      });

      if(!res.ok){
        alert('Erro ao salvar a proposta.');
        return;
      }
      const out = await res.json();
      alert(`Proposta salva: versão v${out.versao}`);
      await carregarPropostas();
    });
  }
}

function formatDateTime(dt){
  if(!dt) return '—';
  const [d,t] = String(dt).split(' ');
  return `${formatDateISO(d)} ${t?.slice(0,5) || ''}`.trim();
}

async function carregarPropostas(){
  bindPropostaUI();

  const id = qs('id');
  if(!id) return;

  // Prefill title once
  const cli = document.getElementById('clienteNome')?.textContent?.trim() || '';
  const t = document.getElementById('propTitulo');
  if(t && !t.value){
    t.value = cli ? `Proposta Comercial • ${cli}` : 'Proposta Comercial';
  }

  const res = await fetch(`/api/eventos/${id}/propostas`);
  if(!res.ok) return;
  const versoes = await res.json();

  const tbody = document.getElementById('propVersoes');
  const empty = document.getElementById('propVersoesEmpty');
  if(!tbody) return;

  tbody.innerHTML = '';
  if(Array.isArray(versoes) && versoes.length){
    if(empty) empty.style.display='none';
    versoes.forEach(v => {
      const tr = document.createElement('tr');
      const safeTitle = String(v.titulo || '').replaceAll('<','&lt;');
      tr.innerHTML = `
        <td><span class="pill">${'v'+v.versao}</span></td>
        <td>${safeTitle}</td>
        <td>${formatDateTime(v.created_at)}</td>
        <td><a class="btn-sm" href="/api/propostas/${v.id}/render" target="_blank" rel="noopener">Abrir/Imprimir</a></td>
      `;
      tbody.appendChild(tr);
    });
    propLastId = versoes[0]?.id || null;
  } else {
    if(empty) empty.style.display='block';
    propLastId = null;
  }

  const btnLast = document.getElementById('btnPropImprimirUltima');
  if(btnLast){
    if(propLastId){
      btnLast.href = `/api/propostas/${propLastId}/render`;
      btnLast.style.pointerEvents = '';
      btnLast.style.opacity = '';
      btnLast.title = 'Abrir a última versão';
    } else {
      btnLast.href = '#';
      btnLast.style.pointerEvents = 'none';
      btnLast.style.opacity = '.6';
      btnLast.title = 'Nenhuma proposta gerada ainda';
    }
  }

  renderPropItems();
}

// tabs click
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// inicia
setActiveTab('equipe');


carregar();



// ===== Event edit modal (Module 3) =====
function parseDecimalBR(v){
  if(v === null || v === undefined) return 0;
  const s = String(v).trim();
  if(!s) return 0;
  // Accept "1.234,56" or "1234.56"
  const normalized = s.replace(/\./g,'').replace(',', '.').replace(/[^0-9.\-]/g,'');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

async function carregarClientesParaEdicao(){
  const res = await fetch('/api/clientes');
  const list = res.ok ? await res.json() : [];
  const sel = document.getElementById('evCliente');
  if(!sel) return;
  sel.innerHTML = list.map(c => `<option value="${c.id}">${c.nome} (${c.telefone || 's/ tel'})</option>`).join('');
}

function abrirModalEvento(){
  const modal = document.getElementById('modalEvento');
  if(!modal) return;
  modal.hidden = false;
}

function fecharModalEvento(){
  const modal = document.getElementById('modalEvento');
  if(modal) modal.hidden = true;
}

function preencherModalEvento(){
  if(!evento) return;

  const evCliente = document.getElementById('evCliente');
  if(evCliente) evCliente.value = String(evento.cliente_id || '');

  document.getElementById('evTipo').value = evento.tipo_evento || 'Outro';
  document.getElementById('evData').value = evento.data_evento || '';
  document.getElementById('evConvidados').value = Number(evento.convidados || 0);
  document.getElementById('evValorTotal').value = String(evento.valor_total || 0);
  document.getElementById('evStatus').value = evento.status || 'orcamento';
  document.getElementById('evForma').value = evento.forma_pagamento || '';
  document.getElementById('evContrato').value = evento.contrato_numero || '';
}

async function salvarEventoBasico(){
  const id = qs('id');
  if(!id) return;

  const payload = {
    cliente_id: Number(document.getElementById('evCliente').value),
    tipo_evento: document.getElementById('evTipo').value,
    data_evento: document.getElementById('evData').value || null,
    convidados: Number(document.getElementById('evConvidados').value || 0),
    valor_total: parseDecimalBR(document.getElementById('evValorTotal').value),
    status: document.getElementById('evStatus').value,
    forma_pagamento: document.getElementById('evForma').value || null,
    contrato_numero: (document.getElementById('evContrato').value || '').trim() || null
  };

  const res = await fetch('/api/eventos/' + id, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(!res.ok){
    alert('Erro ao salvar dados da festa.');
    return;
  }

  fecharModalEvento();
  await carregar();
  alert('Dados da festa atualizados ✅');
}

document.getElementById('btnEditarEvento')?.addEventListener('click', async () => {
  await carregarClientesParaEdicao();
  preencherModalEvento();
  abrirModalEvento();
});

document.getElementById('btnEventoSalvar')?.addEventListener('click', salvarEventoBasico);

document.getElementById('modalEvento')?.addEventListener('click', (e) => {
  const t = e.target;
  if(t?.dataset?.close === '1') fecharModalEvento();
});
