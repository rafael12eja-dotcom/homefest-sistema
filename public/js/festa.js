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

// Tabs placeholder
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

carregar();
