function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function clientesAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","clientes",":id?"]
  const id = parts[2];

  if (request.method === 'GET' && !id) {
    // lista clientes com último evento (simples)
    const q = `
      SELECT c.id, c.nome, c.telefone, c.email, c.cidade, c.bairro,
        (SELECT contrato_numero FROM eventos e WHERE e.cliente_id = c.id ORDER BY e.id DESC LIMIT 1) AS ultimo_evento
      FROM clientes c
      ORDER BY c.id DESC
    `;
    const { results } = await env.DB.prepare(q).all();
    return json(results);
  }

  if (request.method === 'GET' && id) {
    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=?').bind(id).first();
    if (!cliente) return new Response('Cliente não encontrado', { status: 404 });

    const { results: eventos } = await env.DB.prepare(
      'SELECT * FROM eventos WHERE cliente_id=? ORDER BY id DESC'
    ).bind(id).all();

    return json({ cliente, eventos });
  }

  return new Response('Método não permitido', { status: 405 });
}
