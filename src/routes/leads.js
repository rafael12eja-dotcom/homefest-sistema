function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function pad(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

export async function leadsAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","leads",":id?","converter?"]
  const id = parts[2]; // may be undefined
  const sub = parts[3]; // may be "converter"

  if (request.method === 'GET' && !id) {
    const { results } = await env.DB.prepare('SELECT * FROM leads ORDER BY id DESC').all();
    return json(results);
  }

  if (request.method === 'POST' && !id) {
    const b = await request.json();
    await env.DB.prepare(`
      INSERT INTO leads (nome,telefone,email,cidade,bairro,origem,status,observacoes)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      b.nome, b.telefone, b.email, b.cidade, b.bairro, b.origem, b.status, b.observacoes
    ).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE' && id && !sub) {
    await env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // POST /api/leads/:id/converter  (Opção B)
  if (request.method === 'POST' && id && sub === 'converter') {
    const b = await request.json();

    // 1) buscar lead
    const leadStmt = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
    if (!leadStmt) return new Response('Lead não encontrado', { status: 404 });

    // 2) marcar lead como fechado
    await env.DB.prepare("UPDATE leads SET status='fechado' WHERE id=?").bind(id).run();

    // 3) criar cliente (se já existir para esse lead, reutiliza)
    let clienteId = null;
    const existente = await env.DB.prepare('SELECT id FROM clientes WHERE lead_id=?').bind(id).first();
    if (existente?.id) {
      clienteId = existente.id;
    } else {
      const insCliente = await env.DB.prepare(`
        INSERT INTO clientes (lead_id, nome, telefone, email, cidade, bairro)
        VALUES (?,?,?,?,?,?)
      `).bind(
        id,
        leadStmt.nome || null,
        leadStmt.telefone || null,
        leadStmt.email || null,
        leadStmt.cidade || null,
        leadStmt.bairro || null
      ).run();
      clienteId = insCliente.meta.last_row_id;
    }

    // 4) criar evento
    const insEvento = await env.DB.prepare(`
      INSERT INTO eventos (cliente_id, tipo_evento, data_evento, convidados, valor_total, status, forma_pagamento)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      clienteId,
      b.tipo_evento || 'Outro',
      b.data_evento || null,
      b.convidados || 0,
      b.valor_total || 0,
      'fechado',
      b.forma_pagamento || null
    ).run();

    const eventoId = insEvento.meta.last_row_id;

    // 5) gerar numero contrato HF-YYYY-00001 (baseado no eventoId)
    const year = new Date().getFullYear();
    const contrato = `HF-${year}-${pad(eventoId, 5)}`;

    // salvar número do contrato no evento
    await env.DB.prepare('UPDATE eventos SET contrato_numero=? WHERE id=?').bind(contrato, eventoId).run();

    // 6) criar financeiro inicial (sinal)
    const valorSinal = Number(b.valor_sinal || 0);
    if (valorSinal > 0) {
      const today = new Date().toISOString().slice(0,10);
      await env.DB.prepare(`
        INSERT INTO financeiro (evento_id, tipo, descricao, valor, data_movimento)
        VALUES (?,?,?,?,?)
      `).bind(
        eventoId,
        'entrada',
        `Sinal do contrato ${contrato}`,
        valorSinal,
        today
      ).run();
    }

    return json({ ok: true, cliente_id: clienteId, evento_id: eventoId, contrato_numero: contrato });
  }

  return new Response('Método não permitido', { status: 405 });
}
