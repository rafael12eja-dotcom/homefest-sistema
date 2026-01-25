function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function text(msg, status = 200, extraHeaders = {}) {
  return new Response(msg, {
    status,
    headers: {
      ...extraHeaders,
    },
  });
}

function pickStr(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.trim();
}

function pickNullableStr(v) {
  const s = pickStr(v);
  return s ? s : null;
}

function asInt(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// Clientes API
// - GET    /api/clientes
// - POST   /api/clientes
// - GET    /api/clientes/:id
// - PUT    /api/clientes/:id
export async function clientesAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","clientes",":id?", ...]
  const id = parts[2];

  // GET /api/clientes
  if (request.method === 'GET' && !id) {
    // List customers with last event and total events (lightweight)
    const q = `
      SELECT
        c.id,
        c.lead_id,
        c.nome,
        c.telefone,
        c.email,
        c.cidade,
        c.bairro,
        c.cep,
        c.endereco,
        c.numero,
        c.complemento,
        c.estado,
        c.observacoes,
        (SELECT COUNT(1) FROM eventos e WHERE e.cliente_id = c.id) AS total_eventos,
        (SELECT e2.data_evento FROM eventos e2 WHERE e2.cliente_id = c.id ORDER BY e2.id DESC LIMIT 1) AS ultimo_evento_data,
        (SELECT e3.contrato_numero FROM eventos e3 WHERE e3.cliente_id = c.id ORDER BY e3.id DESC LIMIT 1) AS ultimo_evento_contrato
      FROM clientes c
      ORDER BY c.id DESC
    `;

    const { results } = await env.DB.prepare(q).all();
    return json(results);
  }

  // POST /api/clientes
  if (request.method === 'POST' && !id) {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return text('JSON inválido', 400);
    }

    const nome = pickStr(body.nome);
    if (!nome) return text('Nome é obrigatório', 400);

    const leadId = body.lead_id ? asInt(body.lead_id, null) : null;

    const stmt = await env.DB.prepare(`
      INSERT INTO clientes (
        lead_id, nome, telefone, email, cidade, bairro,
        cep, endereco, numero, complemento, estado, observacoes
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      leadId,
      nome,
      pickNullableStr(body.telefone),
      pickNullableStr(body.email),
      pickNullableStr(body.cidade),
      pickNullableStr(body.bairro),
      pickNullableStr(body.cep),
      pickNullableStr(body.endereco),
      pickNullableStr(body.numero),
      pickNullableStr(body.complemento),
      pickNullableStr(body.estado),
      pickNullableStr(body.observacoes)
    ).run();

    const newId = stmt.meta.last_row_id;
    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(newId).first();
    // Backward/forward compatible: expose id at top-level for lightweight clients.
    return json({ ok: true, id: newId, cliente }, 201);
  }

  // GET /api/clientes/:id
  if (request.method === 'GET' && id) {
    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(id).first();
    if (!cliente) return text('Cliente não encontrado', 404);

    const { results: eventos } = await env.DB.prepare(`
      SELECT id, tipo_evento, data_evento, convidados, valor_total, status, contrato_numero, forma_pagamento, criado_em
      FROM eventos
      WHERE cliente_id=?
      ORDER BY id DESC
    `).bind(id).all();

    return json({ cliente, eventos });
  }

  // PUT /api/clientes/:id
  if (request.method === 'PUT' && id) {
    let body = {};
    try {
      body = await request.json();
    } catch {
      return text('JSON inválido', 400);
    }

    const exists = await env.DB.prepare('SELECT id FROM clientes WHERE id=?').bind(id).first();
    if (!exists) return text('Cliente não encontrado', 404);

    const nome = pickStr(body.nome);
    if (!nome) return text('Nome é obrigatório', 400);

    await env.DB.prepare(`
      UPDATE clientes
      SET
        nome=?,
        telefone=?,
        email=?,
        cidade=?,
        bairro=?,
        cep=?,
        endereco=?,
        numero=?,
        complemento=?,
        estado=?,
        observacoes=?
      WHERE id=?
    `).bind(
      nome,
      pickNullableStr(body.telefone),
      pickNullableStr(body.email),
      pickNullableStr(body.cidade),
      pickNullableStr(body.bairro),
      pickNullableStr(body.cep),
      pickNullableStr(body.endereco),
      pickNullableStr(body.numero),
      pickNullableStr(body.complemento),
      pickNullableStr(body.estado),
      pickNullableStr(body.observacoes),
      id
    ).run();

    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(id).first();
    return json({ ok: true, cliente });
  }

  return text('Método não permitido', 405);
}
