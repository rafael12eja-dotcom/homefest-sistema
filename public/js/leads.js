let leadSelecionadoId = null;
let leadSelecionadoNome = null;

function fmtMoney(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  if (Number.isNaN(v)) return '';
  return v.toFixed(2);
}

async function carregarLeads() {
  const res = await fetch('/api/leads');
  const dados = await res.json();

  const lista = document.getElementById('lista');
  lista.innerHTML = '';

  dados.forEach(l => {
    const btnFechar = l.status !== 'fechado'
      ? `<button class="btn btn-success" onclick="abrirModalFechar(${l.id}, ${JSON.stringify(l.nome)})">Fechar contrato</button>`
      : '';

    lista.innerHTML += `
      <tr>
        <td>${l.nome || ''}</td>
        <td>${l.telefone || ''}</td>
        <td>${l.cidade || ''}</td>
        <td>${l.status || ''}</td>
        <td>${l.origem || ''}</td>
        <td style="display:flex; gap:8px; flex-wrap:wrap;">
          ${btnFechar}
          <button class="btn btn-danger" onclick="excluirLead(${l.id})">Excluir</button>
        </td>
      </tr>
    `;
  });
}

async function salvarLead() {
  await fetch('/api/leads', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      nome: nome.value,
      telefone: telefone.value,
      email: email.value,
      cidade: cidade.value,
      bairro: bairro.value,
      origem: origem.value,
      status: status.value,
      observacoes: observacoes.value
    })
  });

  // limpar campos
  nome.value = '';
  telefone.value = '';
  email.value = '';
  cidade.value = '';
  bairro.value = '';
  origem.value = '';
  status.value = 'novo';
  observacoes.value = '';

  carregarLeads();
}

async function excluirLead(id) {
  await fetch('/api/leads/' + id, { method: 'DELETE' });
  carregarLeads();
}

function abrirModalFechar(id, nomeLead) {
  leadSelecionadoId = id;
  leadSelecionadoNome = nomeLead;

  document.getElementById('modalLeadNome').textContent = nomeLead || '';
  document.getElementById('m_tipo_evento').value = 'Infantil';
  document.getElementById('m_data_evento').value = '';
  document.getElementById('m_convidados').value = '';
  document.getElementById('m_valor_total').value = '';
  document.getElementById('m_valor_sinal').value = '';
  document.getElementById('m_forma_pagamento').value = '50% agora e 50% até 1 semana antes';
  document.getElementById('m_obs').value = '';

  const modal = document.getElementById('modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function fecharModal() {
  const modal = document.getElementById('modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  leadSelecionadoId = null;
  leadSelecionadoNome = null;
}

async function confirmarFechamento() {
  if (!leadSelecionadoId) return;

  const payload = {
    tipo_evento: document.getElementById('m_tipo_evento').value,
    data_evento: document.getElementById('m_data_evento').value || null,
    convidados: Number(document.getElementById('m_convidados').value || 0),
    valor_total: Number(document.getElementById('m_valor_total').value || 0),
    valor_sinal: Number(document.getElementById('m_valor_sinal').value || 0),
    forma_pagamento: document.getElementById('m_forma_pagamento').value,
    observacoes: document.getElementById('m_obs').value || null
  };

  const res = await fetch('/api/leads/' + leadSelecionadoId + '/converter', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const t = await res.text();
    alert('Erro ao fechar contrato: ' + t);
    return;
  }

  const out = await res.json(); // { cliente_id, evento_id, contrato_numero }
  fecharModal();
  await carregarLeads();

  // Ir para clientes
  window.location.href = '/app/clientes.html#cliente=' + out.cliente_id;
}

carregarLeads();
