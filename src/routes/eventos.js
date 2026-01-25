function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function contractNumberFromId(id) {
  const year = new Date().getFullYear();
  const seq = String(id).padStart(5, '0');
  return `HF-${year}-${seq}`;
}

export async function eventosAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","eventos",":id?"]
  const id = parts[2];

  // PROPOSALS (linked to event)
  // /api/eventos/:id/propostas
  if (id && parts[3] === 'propostas') {
    // LIST proposals for event
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare(
        'SELECT id, evento_id, versao, titulo, status, created_at FROM propostas WHERE evento_id=? ORDER BY versao DESC'
      ).bind(id).all();
      return json(results);
    }

    // CREATE a new proposal version for event
    if (request.method === 'POST') {
      const b = await request.json();
      const payload = {
        titulo: (b.titulo || 'Proposta Comercial').trim(),
        items: Array.isArray(b.items) ? b.items : [],
        desconto: Number(b.desconto || 0),
        observacoes: (b.observacoes || '').trim(),
        condicoes: (b.condicoes || '').trim(),
        validade: (b.validade || '').trim(),
        created_by: b.created_by || null
      };

      // Determine next version
      const row = await env.DB.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM propostas WHERE evento_id=?').bind(id).first();
      const nextV = (row?.v || 0) + 1;

      const titulo = payload.titulo;
      const status = (b.status || 'rascunho').trim() || 'rascunho';

      const ins = await env.DB.prepare(
        'INSERT INTO propostas (evento_id, versao, titulo, status, payload_json) VALUES (?,?,?,?,?)'
      ).bind(id, nextV, titulo, status, JSON.stringify(payload)).run();

      return json({ ok: true, id: ins.meta.last_row_id, versao: nextV });
    }

    return new Response('Método não permitido', { status: 405 });
  }



  // LIST
  if (request.method === 'GET' && !id) {
    // Optional filters (stable + backward compatible)
    const status = url.searchParams.get('status');
    const clienteId = url.searchParams.get('cliente_id');
    const qText = (url.searchParams.get('q') || '').trim().toLowerCase();

    let q = `
      SELECT e.*,
        (SELECT nome FROM clientes c WHERE c.id = e.cliente_id) AS cliente_nome
      FROM eventos e
    `;
    const where = [];
    const binds = [];

    if (status) { where.push('e.status = ?'); binds.push(status); }
    if (clienteId) { where.push('e.cliente_id = ?'); binds.push(clienteId); }

    if (qText) {
      where.push(`LOWER(
        COALESCE((SELECT nome FROM clientes c WHERE c.id = e.cliente_id), '') || ' ' ||
        COALESCE(e.tipo_evento,'') || ' ' ||
        COALESCE(e.contrato_numero,'')
      ) LIKE ?`);
      binds.push(`%${qText}%`);
    }

    if (where.length) q += ` WHERE ${where.join(' AND ')} `;
    q += ' ORDER BY e.id DESC';

    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return json(results);
  }

  // GET ONE
  if (request.method === 'GET' && id) {
    const evento = await env.DB.prepare('SELECT * FROM eventos WHERE id=?').bind(id).first();
    if (!evento) return new Response('Evento não encontrado', { status: 404 });

    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(evento.cliente_id).first();
    return json({ evento, cliente });
  }

  // CREATE
  if (request.method === 'POST' && !id) {
    const b = await request.json();

    const ins = await env.DB.prepare(`
      INSERT INTO eventos (cliente_id, tipo_evento, data_evento, convidados, valor_total, status, forma_pagamento, contrato_numero)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      b.cliente_id,
      b.tipo_evento || 'Outro',
      b.data_evento || null,
      b.convidados || 0,
      b.valor_total || 0,
      b.status || 'orcamento',
      b.forma_pagamento || null,
      (b.contrato_numero || null)
    ).run();

    const newId = ins.meta.last_row_id;

    // Auto-generate contract number if empty (keeps backward compatibility)
    let contrato_numero = (b.contrato_numero || '').trim();
    if (!contrato_numero) {
      contrato_numero = contractNumberFromId(newId);
      await env.DB.prepare('UPDATE eventos SET contrato_numero=? WHERE id=?').bind(contrato_numero, newId).run();
    }

    return json({ ok: true, id: newId, contrato_numero });
  }

  // UPDATE (PATCH/PUT)
  if ((request.method === 'PATCH' || request.method === 'PUT') && id) {
    const b = await request.json();
    const allow = ['cliente_id','tipo_evento','data_evento','convidados','valor_total','status','forma_pagamento','contrato_numero'];
    const fields = [];
    const binds = [];

    for (const k of allow) {
      if (b[k] !== undefined) {
        fields.push(`${k}=?`);
        binds.push(b[k]);
      }
    }

    if (!fields.length) return new Response('Nada para atualizar', { status: 400 });

    binds.push(id);
    await env.DB.prepare(`UPDATE eventos SET ${fields.join(', ')} WHERE id=?`).bind(...binds).run();
    return json({ ok: true });
  }

  // DELETE
  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM eventos WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return new Response('Método não permitido', { status: 405 });
}
