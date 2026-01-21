function getHashParam(name) {
  const h = (window.location.hash || '').replace('#','');
  const parts = new URLSearchParams(h);
  return parts.get(name);
}

async function carregarClientes() {
  const res = await fetch('/api/clientes');
  const dados = await res.json();

  const tbody = document.getElementById('clientesLista');
  tbody.innerHTML = '';

  dados.forEach(c => {
    tbody.innerHTML += `
      <tr>
        <td>${c.nome || ''}</td>
        <td>${c.telefone || ''}</td>
        <td>${c.cidade || ''}</td>
        <td>${c.bairro || ''}</td>
        <td>${c.ultimo_evento || ''}</td>
        <td><button class="btn btn-primary" onclick="verCliente(${c.id})">Ver</button></td>
      </tr>
    `;
  });
}

async function verCliente(id) {
  const res = await fetch('/api/clientes/' + id);
  const data = await res.json();

  const card = document.getElementById('detalheCard');
  const el = document.getElementById('detalhe');
  card.style.display = 'block';

  const eventosHtml = (data.eventos || []).map(e => `
    <li>
      <strong>${e.tipo_evento || 'Evento'}</strong> — ${e.data_evento || 'sem data'} — ${e.convidados || 0} convidados — R$ ${(e.valor_total||0).toFixed(2)}
      ${e.contrato_numero ? ` <span class="muted">(${e.contrato_numero})</span>` : ''}
    </li>
  `).join('');

  el.innerHTML = `
    <p><strong>Nome:</strong> ${data.cliente.nome || ''}</p>
    <p><strong>Telefone:</strong> ${data.cliente.telefone || ''}</p>
    <p><strong>Email:</strong> ${data.cliente.email || ''}</p>
    <p><strong>Cidade/Bairro:</strong> ${data.cliente.cidade || ''} — ${data.cliente.bairro || ''}</p>
    <p><strong>Eventos:</strong></p>
    <ul>${eventosHtml || '<li>Nenhum evento encontrado</li>'}</ul>
  `;

  window.location.hash = 'cliente=' + id;
}

(async function init(){
  await carregarClientes();
  const id = getHashParam('cliente');
  if (id) verCliente(Number(id));
})();
