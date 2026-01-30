import { json, fail, getAuth, requireTenant } from '../utils/api.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';

function asNumber(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

export async function dashboardAPI(request, env) {
  try {
    const auth = getAuth(request);
    const tenantErr = requireTenant(auth);
    if (tenantErr) return tenantErr;

    const permErr = await requirePermission(env, auth, 'dashboard', actionFromHttp(request.method) || 'read');
    if (permErr) return permErr;
    if (request.method !== 'GET') return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');

    // Base counts
    const leads = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE empresa_id=? AND ativo=1')
      .bind(auth.empresaId).first();
    const clientes = await env.DB.prepare('SELECT COUNT(*) AS n FROM clientes WHERE empresa_id=? AND ativo=1')
      .bind(auth.empresaId).first();
    const festas = await env.DB.prepare('SELECT COUNT(*) AS n FROM eventos WHERE empresa_id=? AND ativo=1')
      .bind(auth.empresaId).first();

    // Leads (last 30 days)
    const novosLeads30d = await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM leads
      WHERE empresa_id=? AND ativo=1 AND criado_em >= datetime('now','-30 days')
    `).bind(auth.empresaId).first();

    const leadsFechados = await env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM leads
      WHERE empresa_id=? AND ativo=1 AND status='fechado'
    `).bind(auth.empresaId).first();

    const totalLeads = asNumber(leads?.n);
    const fechados = asNumber(leadsFechados?.n);
    const taxaConversao = totalLeads > 0 ? (fechados / totalLeads) * 100 : 0;

    // Eventos por status
    const { results: eventosPorStatusRows } = await env.DB.prepare(`
      SELECT status, COUNT(*) AS n
      FROM eventos
      WHERE empresa_id=? AND ativo=1
      GROUP BY status
    `).bind(auth.empresaId).all();

    const eventosPorStatus = {};
    for (const r of (eventosPorStatusRows || [])) {
      eventosPorStatus[r.status || ''] = asNumber(r.n);
    }

    // Receita prevista (A/R: parcelas abertas + pagas)
    const { results: receitaPrevRows } = await env.DB.prepare(`
      SELECT COALESCE(SUM(valor),0) AS total
      FROM ar_parcelas
      WHERE empresa_id=? AND ativo=1 AND status IN ('aberta','paga')
    `).bind(auth.empresaId).all();
    const receitaPrevista = asNumber(receitaPrevRows?.[0]?.total ?? 0);


    // Receita realizada (parcelas pagas)
    const { results: receitaRealRows } = await env.DB.prepare(`
      SELECT COALESCE(SUM(valor),0) AS total
      FROM ar_parcelas
      WHERE empresa_id=? AND ativo=1 AND status='paga'
    `).bind(auth.empresaId).all();
    const receitaRealizada = asNumber(receitaRealRows?.[0]?.total ?? 0);

    // Caixa saldo
    const caixa = await env.DB.prepare(`
      SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) AS saldo
      FROM caixa_lancamentos
      WHERE empresa_id=? AND ativo=1
    `).bind(auth.empresaId).first();

    // Próximas 5 festas (por data_evento)
    const { results: proximas } = await env.DB.prepare(`
      SELECT e.id, e.tipo_evento, e.data_evento, e.convidados, e.valor_total, e.status,
        (SELECT nome FROM clientes c WHERE c.id = e.cliente_id AND c.empresa_id = e.empresa_id AND c.ativo=1) AS cliente_nome
      FROM eventos e
      WHERE e.empresa_id=? AND e.ativo=1 AND e.data_evento IS NOT NULL AND date(e.data_evento) >= date('now')
      ORDER BY e.data_evento ASC
      LIMIT 5
    `).bind(auth.empresaId).all();

    return json({
      cards: {
        leads: asNumber(leads?.n),
        clientes: asNumber(clientes?.n),
        festas: asNumber(festas?.n),
        caixa_saldo: asNumber(caixa?.saldo),
      },
      kpis: {
        novosLeads30d: asNumber(novosLeads30d?.n),
        taxaConversao: Math.round(taxaConversao * 10) / 10, // 1 decimal
        receitaPrevista,
        receitaRealizada,
        saldoCaixa: asNumber(caixa?.saldo),
      },
      eventosPorStatus,
      proximas: proximas || [],
    });
  } catch (err) {
    console.error('dashboardAPI error', err);
    return fail(500, 'DASHBOARD_ERROR', 'Falha ao carregar dashboard');
  }
}
