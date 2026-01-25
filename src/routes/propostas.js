function html(body, status=200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function money(v){
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function calcTotals(items, desconto){
  const rows = Array.isArray(items) ? items : [];
  const subtotal = rows.reduce((acc, it) => {
    const q = Number(it.qtd || 0);
    const u = Number(it.unit || 0);
    return acc + (q * u);
  }, 0);
  const d = Number(desconto || 0);
  const total = Math.max(0, subtotal - d);
  return { subtotal, desconto: d, total };
}

export async function propostasAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","propostas",":id","render?"]
  const id = parts[2];
  const action = parts[3];

  // Render proposal HTML
  if (request.method === 'GET' && id && action === 'render') {
    const prop = await env.DB.prepare('SELECT * FROM propostas WHERE id=?').bind(id).first();
    if (!prop) return html('<h1>Proposta não encontrada</h1>', 404);

    const ev = await env.DB.prepare('SELECT * FROM eventos WHERE id=?').bind(prop.evento_id).first();
    const cli = ev ? await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(ev.cliente_id).first() : null;

    let payload = {};
    try { payload = JSON.parse(prop.payload_json || '{}'); } catch { payload = {}; }
    const items = Array.isArray(payload.items) ? payload.items : [];
    const totals = calcTotals(items, payload.desconto);

    const titulo = escapeHtml(prop.titulo || payload.titulo || 'Proposta Comercial');
    const clienteNome = escapeHtml(cli?.nome || '—');
    const eventoTipo = escapeHtml(ev?.tipo_evento || '—');
    const eventoData = escapeHtml(ev?.data_evento || '—');
    const contrato = escapeHtml(ev?.contrato_numero || '—');

    const condicoes = escapeHtml(payload.condicoes || '');
    const observacoes = escapeHtml(payload.observacoes || '');
    const validade = escapeHtml(payload.validade || '');

    const rowsHtml = items.map((it, idx) => {
      const desc = escapeHtml(it.desc || '');
      const qtd = Number(it.qtd || 0);
      const unit = Number(it.unit || 0);
      const total = qtd * unit;
      return `
        <tr>
          <td style="width:44px;">${idx+1}</td>
          <td>${desc}</td>
          <td style="width:90px; text-align:right;">${qtd}</td>
          <td style="width:140px; text-align:right;">${money(unit)}</td>
          <td style="width:160px; text-align:right; font-weight:700;">${money(total)}</td>
        </tr>
      `;
    }).join('');

    const stamp = escapeHtml(prop.created_at || '');
    const versao = Number(prop.versao || 1);

    const doc = `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${titulo} • ${clienteNome}</title>
  <style>
    *{ box-sizing:border-box; }
    body{ margin:0; font: 500 14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; background: #fff; color:#0b1220;}
    .page{ max-width: 980px; margin: 28px auto; padding: 0 18px; }
    .top{
      display:flex; justify-content:space-between; gap:18px; align-items:flex-start;
      border:1px solid #e5e7eb; border-radius: 16px; padding: 18px 18px;
    }
    .brand{ font-weight: 900; letter-spacing:.2px; font-size: 18px; }
    .tag{ display:inline-block; padding: 6px 10px; border-radius:999px; border:1px solid #e5e7eb; font-weight:800; }
    h1{ margin: 14px 0 6px; font-size: 26px; letter-spacing:-.02em; }
    .meta{ color:#334155; display:grid; gap:4px; }
    table{ width:100%; border-collapse: collapse; margin-top: 14px; border:1px solid #e5e7eb; border-radius: 16px; overflow:hidden; }
    th, td{ padding: 10px 12px; border-bottom:1px solid #e5e7eb; }
    th{ background:#f8fafc; text-align:left; font-size: 12px; text-transform: uppercase; letter-spacing:.05em; color:#475569; }
    .totals{ margin-top: 14px; display:flex; justify-content:flex-end; }
    .totals .box{ width: 380px; border:1px solid #e5e7eb; border-radius: 16px; padding: 12px 14px; }
    .row{ display:flex; justify-content:space-between; padding: 6px 0; }
    .row strong{ font-weight: 900; }
    .muted{ color:#475569; }
    .section{ margin-top: 14px; border:1px solid #e5e7eb; border-radius: 16px; padding: 14px 14px; }
    .section h3{ margin:0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing:.05em; color:#334155;}
    .footer{ margin: 18px 0; color:#64748b; font-size: 12px; display:flex; justify-content:space-between; }
    @media print{
      body{ background:#fff; }
      .page{ margin:0; max-width:none; }
      .footer{ position: fixed; bottom: 0; left: 0; right: 0; padding: 8px 18px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="top">
      <div>
        <div class="brand">Home Fest & Eventos</div>
        <div class="meta">
          <div><strong>Cliente:</strong> ${clienteNome}</div>
          <div><strong>Evento:</strong> ${eventoTipo} • ${eventoData}</div>
          <div><strong>Contrato:</strong> ${contrato}</div>
        </div>
        <h1>${titulo}</h1>
        <div class="muted">Versão ${versao} • Gerada em ${stamp}</div>
      </div>
      <div style="text-align:right;">
        <div class="tag">Proposta</div>
        <div class="muted" style="margin-top:10px;">sistema.homefesteeventos.com.br</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Item / Descrição</th>
          <th style="text-align:right;">Qtd</th>
          <th style="text-align:right;">Unitário</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || '<tr><td colspan="5" style="padding:18px; color:#64748b;">Nenhum item informado.</td></tr>'}
      </tbody>
    </table>

    <div class="totals">
      <div class="box">
        <div class="row"><span class="muted">Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
        <div class="row"><span class="muted">Desconto</span><strong>${money(totals.desconto)}</strong></div>
        <div class="row" style="border-top:1px solid #e5e7eb; margin-top:6px; padding-top:10px;">
          <span style="font-weight:900;">Total</span><strong style="font-size:16px;">${money(totals.total)}</strong>
        </div>
      </div>
    </div>

    ${condicoes ? `<div class="section"><h3>Condições</h3><div>${condicoes.replaceAll('\n','<br/>')}</div></div>` : ''}
    ${validade ? `<div class="section"><h3>Validade</h3><div>${validade.replaceAll('\n','<br/>')}</div></div>` : ''}
    ${observacoes ? `<div class="section"><h3>Observações</h3><div>${observacoes.replaceAll('\n','<br/>')}</div></div>` : ''}

    <div class="footer">
      <div>Home Fest & Eventos • Proposta gerada pelo sistema</div>
      <div>Versão ${versao}</div>
    </div>
  </div>
</body>
</html>`;

    return html(doc);
  }

  return html('<h1>Rota não encontrada</h1>', 404);
}
