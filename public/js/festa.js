function qs(name){
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function money(v){
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}


function parseBRL(s){
  if(typeof s === 'number') return s;
  const t = String(s || '').replace(/\./g,'').replace(',', '.').replace(/[^\d.-]/g,'');
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
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

  // Equipe
  fillEquipeSelect();
  setupTabs();
  document.getElementById('btnAddEquipe')?.addEventListener('click', () => openEquipeModal(evento.id));
  await loadEquipe(evento.id);

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

  await 
const FUNCOES_EQUIPE = [
  "Coordenação / Produção",
  "Chefe de Cozinha",
  "Cozinheira",
  "Auxiliar de Cozinha",
  "Garçom",
  "Barman",
  "Chapeiro",
  "Recreador(a)",
  "Monitor(a)",
  "Segurança",
  "Recepcionista",
  "Faxina / Apoio",
  "Fotógrafo",
  "Filmagem",
  "DJ / Som",
  "Decorador(a)",
  "Montagem / Estrutura",
];

let equipeEditingId = null;

function fillEquipeSelect(){
  const sel = document.getElementById('eqItem');
  if(!sel) return;
  sel.innerHTML = FUNCOES_EQUIPE.map(f => `<option value="${f}">${f}</option>`).join('');
}

async function loadEquipe(eventoId){
  const res = await fetch(`/api/eventos/${eventoId}/equipe`);
  const data = await res.json();
  if(!res.ok || data.ok === false){
    console.error(data);
    return;
  }
  document.getElementById('equipeTotal').textContent = money(data.total || 0);
  renderEquipeList(eventoId, data.items || []);
}

function renderEquipeList(eventoId, items){
  const wrap = document.getElementById('equipeList');
  if(!wrap) return;

  if(!items.length){
    wrap.innerHTML = `<div class="empty"><div class="empty-title">Nenhum item cadastrado</div><div class="empty-text">Clique em <b>Adicionar</b> para incluir a equipe.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Função</th>
          <th>Qtd</th>
          <th>Unid.</th>
          <th>R$ Unit.</th>
          <th>Total</th>
          <th>Fornecedor</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td>${it.item || ''}</td>
            <td>${it.quantidade ?? ''}</td>
            <td>${it.unidade || ''}</td>
            <td>${money(it.valor_unitario || 0)}</td>
            <td><strong>${money(it.valor_total || 0)}</strong></td>
            <td>${it.fornecedor || ''}</td>
            <td class="actions">
              <button class="btn-ghost btn-sm" data-edit="${it.id}">Editar</button>
              <button class="btn-ghost btn-sm danger" data-del="${it.id}">Excluir</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => String(i.id) === btn.dataset.edit);
      openEquipeModal(eventoId, item);
    });
  });

  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Excluir este item de equipe?')) return;
      await fetch(`/api/eventos/${eventoId}/equipe/${btn.dataset.del}`, { method:'DELETE' });
      await loadEquipe(eventoId);
    });
  });
}

function openEquipeModal(eventoId, item=null){
  equipeEditingId = item ? item.id : null;

  document.getElementById('modalEquipeTitle').textContent = item ? 'Editar membro' : 'Adicionar membro';
  document.getElementById('eqItem').value = item?.item || FUNCOES_EQUIPE[0];
  document.getElementById('eqFornecedor').value = item?.fornecedor || '';
  document.getElementById('eqQtd').value = item?.quantidade ?? 1;
  document.getElementById('eqUnidade').value = item?.unidade || 'pessoa';
  document.getElementById('eqVU').value = String(item?.valor_unitario ?? 0).replace('.', ',');
  document.getElementById('eqVT').value = String(item?.valor_total ?? 0).replace('.', ',');
  document.getElementById('eqObs').value = item?.observacao || '';

  const modal = document.getElementById('modalEquipe');
  modal.classList.remove('hidden');

  const recalc = () => {
    const qtd = Number(document.getElementById('eqQtd').value || 0);
    const vu = parseBRL(document.getElementById('eqVU').value);
    const total = qtd * vu;
    document.getElementById('eqVT').value = total.toFixed(2).replace('.', ',');
  };
  document.getElementById('eqQtd').oninput = recalc;
  document.getElementById('eqVU').oninput = recalc;

  document.getElementById('btnSaveEquipe').onclick = async () => {
    const payload = {
      item: document.getElementById('eqItem').value,
      fornecedor: document.getElementById('eqFornecedor').value,
      quantidade: Number(document.getElementById('eqQtd').value || 0),
      unidade: document.getElementById('eqUnidade').value,
      valor_unitario: parseBRL(document.getElementById('eqVU').value),
      valor_total: parseBRL(document.getElementById('eqVT').value),
      observacao: document.getElementById('eqObs').value,
    };

    const url = equipeEditingId
      ? `/api/eventos/${eventoId}/equipe/${equipeEditingId}`
      : `/api/eventos/${eventoId}/equipe`;

    const method = equipeEditingId ? 'PATCH' : 'POST';

    const r = await fetch(url, {
      method,
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(() => ({}));
    if(!r.ok || d.ok === false){
      alert(d.error || 'Falha ao salvar equipe');
      return;
    }
    closeEquipeModal();
    await loadEquipe(eventoId);
  };

  document.getElementById('btnCloseEquipe').onclick = closeEquipeModal;
  document.getElementById('btnCancelEquipe').onclick = closeEquipeModal;
}

function closeEquipeModal(){
  document.getElementById('modalEquipe').classList.add('hidden');
  equipeEditingId = null;
}

function setupTabs(){
  const panelEquipe = document.getElementById('panel-equipe');
  const placeholder = document.getElementById('panel-placeholder');

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      if(tab === 'equipe'){
        panelEquipe.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        panelEquipe.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }
    });
  });
}


carregar();
  alert('Salvo ✅');
}

document.getElementById('btnSalvar')?.addEventListener('click', salvar);


const FUNCOES_EQUIPE = [
  "Coordenação / Produção",
  "Chefe de Cozinha",
  "Cozinheira",
  "Auxiliar de Cozinha",
  "Garçom",
  "Barman",
  "Chapeiro",
  "Recreador(a)",
  "Monitor(a)",
  "Segurança",
  "Recepcionista",
  "Faxina / Apoio",
  "Fotógrafo",
  "Filmagem",
  "DJ / Som",
  "Decorador(a)",
  "Montagem / Estrutura",
];

let equipeEditingId = null;

function fillEquipeSelect(){
  const sel = document.getElementById('eqItem');
  if(!sel) return;
  sel.innerHTML = FUNCOES_EQUIPE.map(f => `<option value="${f}">${f}</option>`).join('');
}

async function loadEquipe(eventoId){
  const res = await fetch(`/api/eventos/${eventoId}/equipe`);
  const data = await res.json();
  if(!res.ok || data.ok === false){
    console.error(data);
    return;
  }
  document.getElementById('equipeTotal').textContent = money(data.total || 0);
  renderEquipeList(eventoId, data.items || []);
}

function renderEquipeList(eventoId, items){
  const wrap = document.getElementById('equipeList');
  if(!wrap) return;

  if(!items.length){
    wrap.innerHTML = `<div class="empty"><div class="empty-title">Nenhum item cadastrado</div><div class="empty-text">Clique em <b>Adicionar</b> para incluir a equipe.</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Função</th>
          <th>Qtd</th>
          <th>Unid.</th>
          <th>R$ Unit.</th>
          <th>Total</th>
          <th>Fornecedor</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        ${items.map(it => `
          <tr>
            <td>${it.item || ''}</td>
            <td>${it.quantidade ?? ''}</td>
            <td>${it.unidade || ''}</td>
            <td>${money(it.valor_unitario || 0)}</td>
            <td><strong>${money(it.valor_total || 0)}</strong></td>
            <td>${it.fornecedor || ''}</td>
            <td class="actions">
              <button class="btn-ghost btn-sm" data-edit="${it.id}">Editar</button>
              <button class="btn-ghost btn-sm danger" data-del="${it.id}">Excluir</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = items.find(i => String(i.id) === btn.dataset.edit);
      openEquipeModal(eventoId, item);
    });
  });

  wrap.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if(!confirm('Excluir este item de equipe?')) return;
      await fetch(`/api/eventos/${eventoId}/equipe/${btn.dataset.del}`, { method:'DELETE' });
      await loadEquipe(eventoId);
    });
  });
}

function openEquipeModal(eventoId, item=null){
  equipeEditingId = item ? item.id : null;

  document.getElementById('modalEquipeTitle').textContent = item ? 'Editar membro' : 'Adicionar membro';
  document.getElementById('eqItem').value = item?.item || FUNCOES_EQUIPE[0];
  document.getElementById('eqFornecedor').value = item?.fornecedor || '';
  document.getElementById('eqQtd').value = item?.quantidade ?? 1;
  document.getElementById('eqUnidade').value = item?.unidade || 'pessoa';
  document.getElementById('eqVU').value = String(item?.valor_unitario ?? 0).replace('.', ',');
  document.getElementById('eqVT').value = String(item?.valor_total ?? 0).replace('.', ',');
  document.getElementById('eqObs').value = item?.observacao || '';

  const modal = document.getElementById('modalEquipe');
  modal.classList.remove('hidden');

  const recalc = () => {
    const qtd = Number(document.getElementById('eqQtd').value || 0);
    const vu = parseBRL(document.getElementById('eqVU').value);
    const total = qtd * vu;
    document.getElementById('eqVT').value = total.toFixed(2).replace('.', ',');
  };
  document.getElementById('eqQtd').oninput = recalc;
  document.getElementById('eqVU').oninput = recalc;

  document.getElementById('btnSaveEquipe').onclick = async () => {
    const payload = {
      item: document.getElementById('eqItem').value,
      fornecedor: document.getElementById('eqFornecedor').value,
      quantidade: Number(document.getElementById('eqQtd').value || 0),
      unidade: document.getElementById('eqUnidade').value,
      valor_unitario: parseBRL(document.getElementById('eqVU').value),
      valor_total: parseBRL(document.getElementById('eqVT').value),
      observacao: document.getElementById('eqObs').value,
    };

    const url = equipeEditingId
      ? `/api/eventos/${eventoId}/equipe/${equipeEditingId}`
      : `/api/eventos/${eventoId}/equipe`;

    const method = equipeEditingId ? 'PATCH' : 'POST';

    const r = await fetch(url, {
      method,
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(() => ({}));
    if(!r.ok || d.ok === false){
      alert(d.error || 'Falha ao salvar equipe');
      return;
    }
    closeEquipeModal();
    await loadEquipe(eventoId);
  };

  document.getElementById('btnCloseEquipe').onclick = closeEquipeModal;
  document.getElementById('btnCancelEquipe').onclick = closeEquipeModal;
}

function closeEquipeModal(){
  document.getElementById('modalEquipe').classList.add('hidden');
  equipeEditingId = null;
}

function setupTabs(){
  const panelEquipe = document.getElementById('panel-equipe');
  const placeholder = document.getElementById('panel-placeholder');

  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      if(tab === 'equipe'){
        panelEquipe.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        panelEquipe.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }
    });
  });
}


carregar();
