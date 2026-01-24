function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function financeiroAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","financeiro",":id?"]
  const id = parts[2];

  if (request.method === 'GET' && !id) {
    const eventoId = url.searchParams.get('evento_id');
    let q = 'SELECT * FROM financeiro';
    const binds = [];
    if (eventoId) { q += ' WHERE evento_id=?'; binds.push(eventoId); }
    q += ' ORDER BY id DESC';
    const { results } = await env.DB.prepare(q).bind(...binds).all();
    return json(results);
  }

  if (request.method === 'POST' && !id) {
    const b = await request.json();
    if (!b.tipo || b.valor === undefined) return new Response('Campos obrigatórios: tipo, valor', { status: 400 });

    const today = new Date().toISOString().slice(0,10);
    const ins = await env.DB.prepare(`
      INSERT INTO financeiro (evento_id, tipo, descricao, valor, data_movimento, origem)
      VALUES (?,?,?,?,?,?)
    `).bind(
      b.evento_id || null,
      b.tipo,
      b.descricao || null,
      Number(b.valor || 0),
      b.data_movimento || today,
      b.origem || null
    ).run();

    return json({ ok: true, id: ins.meta.last_row_id });
  }

  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('DELETE FROM financeiro WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return new Response('Método não permitido', { status: 405 });
}
