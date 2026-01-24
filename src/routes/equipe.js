function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bad(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

function toNumber(v, fallback = 0) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

export async function equipeHandler(req, env, ctx, params) {
  const { method } = req;
  const eventoId = Number(params.eventoId);
  if (!Number.isFinite(eventoId)) return bad("evento_id inválido");

  // garante que o evento existe (auth já é exigida pelo worker)
  const ev = await env.DB.prepare("SELECT id FROM eventos WHERE id = ?")
    .bind(eventoId)
    .first();
  if (!ev) return bad("Evento não encontrado", 404);

  if (method === "GET") {
    const rows = await env.DB.prepare(
      `SELECT id, item, quantidade, unidade, valor_unitario, valor_total, fornecedor, observacao
       FROM evento_itens
       WHERE evento_id = ? AND categoria = 'equipe'
       ORDER BY id DESC`
    ).bind(eventoId).all();

    const total = (rows.results || []).reduce((acc, r) => acc + toNumber(r.valor_total, 0), 0);
    return json({ ok: true, items: rows.results || [], total });
  }

  if (method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body) return bad("JSON inválido");

    const item = String(body.item || "").trim();
    if (!item) return bad("Função é obrigatória");

    const quantidade = toNumber(body.quantidade, 1);
    const unidade = String(body.unidade || "pessoa").trim();
    const valor_unitario = toNumber(body.valor_unitario, 0);
    const valor_total = toNumber(body.valor_total, quantidade * valor_unitario);

    const fornecedor = String(body.fornecedor || "").trim();
    const observacao = String(body.observacao || "").trim();

    const result = await env.DB.prepare(
      `INSERT INTO evento_itens
        (evento_id, categoria, item, quantidade, unidade, valor_unitario, valor_total, fornecedor, observacao)
       VALUES (?, 'equipe', ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(eventoId, item, quantidade, unidade, valor_unitario, valor_total, fornecedor, observacao)
      .run();

    return json({ ok: true, id: result.meta.last_row_id });
  }

  return bad("Método não suportado", 405);
}

export async function equipeItemHandler(req, env, ctx, params) {
  const { method } = req;
  const eventoId = Number(params.eventoId);
  const itemId = Number(params.itemId);
  if (!Number.isFinite(eventoId) || !Number.isFinite(itemId)) return bad("Parâmetros inválidos");

  const exists = await env.DB.prepare(
    `SELECT id FROM evento_itens WHERE id = ? AND evento_id = ? AND categoria = 'equipe'`
  ).bind(itemId, eventoId).first();

  if (!exists) return bad("Item não encontrado", 404);

  if (method === "PATCH" || method === "PUT") {
    const body = await req.json().catch(() => null);
    if (!body) return bad("JSON inválido");

    const item = String(body.item || "").trim();
    if (!item) return bad("Função é obrigatória");

    const quantidade = toNumber(body.quantidade, 1);
    const unidade = String(body.unidade || "pessoa").trim();
    const valor_unitario = toNumber(body.valor_unitario, 0);
    const valor_total = toNumber(body.valor_total, quantidade * valor_unitario);

    const fornecedor = String(body.fornecedor || "").trim();
    const observacao = String(body.observacao || "").trim();

    await env.DB.prepare(
      `UPDATE evento_itens
       SET item=?, quantidade=?, unidade=?, valor_unitario=?, valor_total=?, fornecedor=?, observacao=?
       WHERE id=? AND evento_id=? AND categoria='equipe'`
    )
      .bind(item, quantidade, unidade, valor_unitario, valor_total, fornecedor, observacao, itemId, eventoId)
      .run();

    return json({ ok: true });
  }

  if (method === "DELETE") {
    await env.DB.prepare(
      `DELETE FROM evento_itens WHERE id=? AND evento_id=? AND categoria='equipe'`
    ).bind(itemId, eventoId).run();

    return json({ ok: true });
  }

  return bad("Método não suportado", 405);
}
