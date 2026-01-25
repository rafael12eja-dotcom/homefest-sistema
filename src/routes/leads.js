// src/routes/leads.js
// Leads CRM: pipeline + conversion to client/event + notes/history

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function pad(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

function safeStatus(s) {
  const allowed = new Set([
    'novo',
    'em_atendimento',
    'orcamento_enviado',
    'follow_up',
    'fechado',
    'perdido',
  ]);
  return allowed.has(s) ? s : 'novo';
}

export async function leadsAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","leads",":id?","sub?"]
  const id = parts[2]; // may be undefined
  const sub = parts[3]; // may be "converter" | "notes"

  const userEmail = request.headers.get('x-user') || null;

  // GET /api/leads?status=&q=
  if (request.method === 'GET' && !id) {
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') || '').trim();

    const where = [];
    const binds = [];

    if (status) {
      where.push('status = ?');
      binds.push(safeStatus(status));
    }
    if (q) {
      where.push('(nome LIKE ? OR telefone LIKE ? OR email LIKE ? OR origem LIKE ? OR cidade LIKE ? OR bairro LIKE ?)');
      const like = `%${q}%`;
      binds.push(like, like, like, like, like, like);
    }

    const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(results);
  }

  // GET /api/leads/:id
  if (request.method === 'GET' && id && !sub) {
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
    if (!lead) return text('Lead não encontrado', 404);
    return json(lead);
  }

  // POST /api/leads
  if (request.method === 'POST' && !id) {
    const b = await request.json();
    const nome = String(b.nome || '').trim();
    if (!nome) return text('Nome é obrigatório', 400);

    await env.DB.prepare(`
      INSERT INTO leads (nome,telefone,email,cidade,bairro,origem,status,observacoes)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      nome,
      (b.telefone || null),
      (b.email || null),
      (b.cidade || null),
      (b.bairro || null),
      (b.origem || null),
      safeStatus(b.status || 'novo'),
      (b.observacoes || null)
    ).run();

    return json({ ok: true });
  }

  // PUT /api/leads/:id
  if (request.method === 'PUT' && id && !sub) {
    const b = await request.json();
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
    if (!lead) return text('Lead não encontrado', 404);

    const nome = (b.nome !== undefined) ? String(b.nome || '').trim() : lead.nome;
    if (!nome) return text('Nome é obrigatório', 400);

    await env.DB.prepare(`
      UPDATE leads
      SET nome=?, telefone=?, email=?, cidade=?, bairro=?, origem=?, status=?, observacoes=?
      WHERE id=?
    `).bind(
      nome,
      (b.telefone !== undefined ? (b.telefone || null) : lead.telefone),
      (b.email !== undefined ? (b.email || null) : lead.email),
      (b.cidade !== undefined ? (b.cidade || null) : lead.cidade),
      (b.bairro !== undefined ? (b.bairro || null) : lead.bairro),
      (b.origem !== undefined ? (b.origem || null) : lead.origem),
      (b.status !== undefined ? safeStatus(b.status) : safeStatus(lead.status)),
      (b.observacoes !== undefined ? (b.observacoes || null) : lead.observacoes),
      id
    ).run();

    return json({ ok: true });
  }

  // DELETE /api/leads/:id
  if (request.method === 'DELETE' && id && !sub) {
    await env.DB.prepare('DELETE FROM leads WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // NOTES
  // GET /api/leads/:id/notes
  if (request.method === 'GET' && id && sub === 'notes') {
    const { results } = await env.DB.prepare(
      'SELECT id, lead_id, note, created_by, created_at FROM lead_notes WHERE lead_id=? ORDER BY id DESC'
    ).bind(id).all();
    return json(results);
  }

  // POST /api/leads/:id/notes
  if (request.method === 'POST' && id && sub === 'notes') {
    const b = await request.json();
    const note = String(b.note || '').trim();
    if (!note) return text('Nota vazia', 400);

    await env.DB.prepare(
      'INSERT INTO lead_notes (lead_id, note, created_by) VALUES (?,?,?)'
    ).bind(id, note, userEmail).run();

    return json({ ok: true });
  }

  // POST /api/leads/:id/converter
  if (request.method === 'POST' && id && sub === 'converter') {
    const b = await request.json();

    // 1) buscar lead
    const leadStmt = await env.DB.prepare('SELECT * FROM leads WHERE id=?').bind(id).first();
    if (!leadStmt) return text('Lead não encontrado', 404);

    // 2) marcar lead como fechado
    await env.DB.prepare("UPDATE leads SET status='fechado' WHERE id=?").bind(id).run();

    // 2.1) histórico
    await env.DB.prepare(
      'INSERT INTO lead_notes (lead_id, note, created_by) VALUES (?,?,?)'
    ).bind(id, 'Lead convertido em Cliente + Festa', userEmail).run();

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
    const statusEvento = (b.status_evento && String(b.status_evento).trim()) ? String(b.status_evento).trim() : 'orcamento';
    const insEvento = await env.DB.prepare(`
      INSERT INTO eventos (cliente_id, tipo_evento, data_evento, convidados, valor_total, status, forma_pagamento)
      VALUES (?,?,?,?,?,?,?)
    `).bind(
      clienteId,
      b.tipo_evento || 'Outro',
      b.data_evento || null,
      Number(b.convidados || 0),
      Number(b.valor_total || 0),
      statusEvento,
      b.forma_pagamento || null
    ).run();

    const eventoId = insEvento.meta.last_row_id;

    // 5) gerar numero contrato HF-YYYY-00001 (baseado no eventoId)
    const year = new Date().getFullYear();
    const contrato = `HF-${year}-${pad(eventoId, 5)}`;

    await env.DB.prepare('UPDATE eventos SET contrato_numero=? WHERE id=?').bind(contrato, eventoId).run();

    // 6) financeiro inicial (sinal)
    const valorSinal = Number(b.valor_sinal || 0);
    if (valorSinal > 0) {
      const today = new Date().toISOString().slice(0, 10);
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

  return text('Método não permitido', 405);
}
