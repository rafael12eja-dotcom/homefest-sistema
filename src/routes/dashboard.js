function json(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function dashboardAPI(request, env) {
  if (request.method !== 'GET') return new Response('Método não permitido', { status: 405 });

  // Cards simples e estáveis (não dependem de datas ainda)
  const leads = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads').first();
  const clientes = await env.DB.prepare('SELECT COUNT(*) AS n FROM clientes').first();
  const festas = await env.DB.prepare('SELECT COUNT(*) AS n FROM eventos').first();

  const caixa = await env.DB.prepare(`
    SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) AS saldo
    FROM financeiro
  `).first();

  // Próximas 5 festas (por data_evento)
  const { results: proximas } = await env.DB.prepare(`
    SELECT e.id, e.tipo_evento, e.data_evento, e.convidados, e.valor_total,
      (SELECT nome FROM clientes c WHERE c.id = e.cliente_id) AS cliente_nome
    FROM eventos e
    WHERE e.data_evento IS NOT NULL
    ORDER BY e.data_evento ASC
    LIMIT 5
  `).all();

  return json({
    cards: {
      leads: leads?.n || 0,
      clientes: clientes?.n || 0,
      festas: festas?.n || 0,
      caixa_saldo: caixa?.saldo || 0
    },
    proximas
  });
}
