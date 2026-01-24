function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function eventosAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","eventos",":id?"]
  const id = parts[2];

  if (request.method === 'GET' && !id) {
    const q = `
      SELECT e.*,
        (SELECT nome FROM clientes c WHERE c.id = e.cliente_id) AS cliente_nome
      FROM eventos e
      ORDER BY e.id DESC
    `;
    const { results } = await env.DB.prepare(q).all();
    return json(results);
  }

  if (request.method === 'GET' && id) {
    const evento = await env.DB.prepare('SELECT * FROM eventos WHERE id=?').bind(id).first();
    if (!evento) return new Response('Evento não encontrado', { status: 404 });
    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(evento.cliente_id).first();
    return json({ evento, cliente });
  }

  if (request.method === 'POST' && !id) {
    const b = await request.json();
    const ins = await env.DB.prepare(`
      INSERT INTO eventos (cliente_id, tipo_evento, data_evento, convidados, valor_total, status, forma_pagamento)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      b.cliente_id,
      b.tipo_evento || 'Outro',
      b.data_evento || null,
      b.convidados || 0,
      b.valor_total || 0,
      b.status || 'orcamento',
      b.forma_pagamento || null
    ).run();

    return json({ ok: true, id: ins.meta.last_row_id });
  }

  if (request.method === 'PATCH' && id) {
    const b = await request.json();
    const allow = ['cliente_id','tipo_evento','data_evento','convidados','valor_total','status','forma_pagamento','contrato_numero'];
    const fields = [];
    const binds = [];
    for (const k of allow) {
      if (b[k] !== undefined) { fields.push(`${k}=?`); binds.push(b[k]); }
    }
    if (!fields.length) return new Response('Nada para atualizar', { status: 400 });

    binds.push(id);
    await env.DB.prepare(`UPDATE eventos SET ${fields.join(', ')} WHERE id=?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM eventos WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return new Response('Método não permitido', { status: 405 });
}
