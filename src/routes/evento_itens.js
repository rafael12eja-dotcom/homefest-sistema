function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function eventoItensAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","eventos-itens",":id?"]
  const id = parts[2];

  if (request.method === 'GET') {
    const eventoId = url.searchParams.get('evento_id');
    const categoria = url.searchParams.get('categoria');

    if (!eventoId) return new Response('evento_id é obrigatório', { status: 400 });

    let q = 'SELECT * FROM evento_itens WHERE evento_id=?';
    const binds = [eventoId];

    if (categoria) { q += ' AND categoria=?'; binds.push(categoria); }
    q += ' ORDER BY id DESC';

    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return json(results);
  }

  if (request.method === 'POST' && !id) {
    const b = await request.json();
    if (!b.evento_id || !b.categoria || !b.item) return new Response('Campos obrigatórios: evento_id, categoria, item', { status: 400 });

    const qtd = Number(b.quantidade || 0);
    const vu = Number(b.valor_unitario || 0);
    const vt = (b.valor_total !== undefined && b.valor_total !== null) ? Number(b.valor_total) : (qtd * vu);

    const ins = await env.DB.prepare(`
      INSERT INTO evento_itens (evento_id, categoria, item, quantidade, unidade, fornecedor, valor_unitario, valor_total, status, observacao)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).bind(
      b.evento_id,
      b.categoria,
      b.item,
      qtd,
      b.unidade || null,
      b.fornecedor || null,
      vu,
      vt,
      b.status || 'pendente',
      b.observacao || null
    ).run();

    return json({ ok: true, id: ins.meta.last_row_id });
  }

  if (request.method === 'PATCH' && id) {
    const b = await request.json();
    const allow = ['categoria','item','quantidade','unidade','fornecedor','valor_unitario','valor_total','status','observacao'];
    const fields = [];
    const binds = [];

    for (const k of allow) {
      if (b[k] !== undefined) { fields.push(`${k}=?`); binds.push(b[k]); }
    }
    if (!fields.length) return new Response('Nada para atualizar', { status: 400 });

    // recalcula valor_total se necessário
    // (se o cliente mandar apenas quantidade/valor_unitario e não mandar valor_total)
    if ((b.quantidade !== undefined || b.valor_unitario !== undefined) && b.valor_total === undefined) {
      // buscar atual para completar
      const cur = await env.DB.prepare('SELECT quantidade, valor_unitario FROM evento_itens WHERE id=?').bind(id).first();
      const qtd = Number(b.quantidade !== undefined ? b.quantidade : cur?.quantidade || 0);
      const vu = Number(b.valor_unitario !== undefined ? b.valor_unitario : cur?.valor_unitario || 0);
      fields.push('valor_total=?');
      binds.push(qtd * vu);
    }

    binds.push(id);
    await env.DB.prepare(`UPDATE evento_itens SET ${fields.join(', ')} WHERE id=?`).bind(...binds).run();
    return json({ ok: true });
  }

  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM evento_itens WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return new Response('Método não permitido', { status: 405 });
}
