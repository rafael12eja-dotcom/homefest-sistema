import { json, ok, fail, getAuth, requireTenant, safeJsonBody } from '../utils/api.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';
import { logAudit } from '../utils/audit.js';

function roundQty(value, mode) {
  const v = Number(value || 0);
  if (!isFinite(v)) return 0;
  const m = (mode || 'CEIL').toUpperCase();
  if (m === 'FLOOR') return Math.floor(v);
  return Math.ceil(v);
}

function computeCargoQty(cargo, contexto) {
  const tipo = (cargo.calc_tipo || 'FIXED').toUpperCase();
  const divisor = cargo.calc_divisor ? Number(cargo.calc_divisor) : null;
  const min = Number(cargo.calc_min || 0);
  const roundMode = (cargo.calc_round || 'CEIL').toUpperCase();

  let qty = 0;

  if (tipo === 'PER_GUEST') {
    const base = Number(contexto.convidados || 0);
    const div = divisor && divisor > 0 ? divisor : 1;
    qty = roundQty(base / div, roundMode);
  } else if (tipo === 'PER_CHILD') {
    const base = Number(contexto.criancas || 0);
    const div = divisor && divisor > 0 ? divisor : 1;
    qty = roundQty(base / div, roundMode);
  } else {
    // FIXED: by convention, use calc_min as the fixed quantity.
    qty = roundQty(min, roundMode);
  }

  if (!isFinite(qty) || qty < 0) qty = 0;
  if (qty < min) qty = min;
  return qty;
}

function contractNumberFromId(id) {
  const year = new Date().getFullYear();
  const seq = String(id).padStart(5, '0');
  return `HF-${year}-${seq}`;
}


async function recomputeEventoEquipe(env, auth, eventoId, convidadosOverride = null) {
  // Loads active cargos and recomputes ONLY auto-calculated rows for the given event.
  // Preserves manual overrides (auto_calculado=0).
  const ev = await env.DB.prepare('SELECT id, convidados FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
    .bind(eventoId, auth.empresaId).first();
  if (!ev) return { ok: false, error: 'NOT_FOUND' };

  const convidados = (convidadosOverride !== null) ? Number(convidadosOverride || 0) : Number(ev.convidados || 0);

  const { results: cargos } = await env.DB.prepare(
    `SELECT id, codigo, nome, calc_tipo, calc_divisor, calc_min, calc_round, custo_padrao, ativo
     FROM equipe_cargos
     WHERE empresa_id=? AND ativo=1
     ORDER BY ordem ASC, id ASC`
  ).bind(auth.empresaId).all();

  const contexto = { convidados, criancas: 0 };

  await env.DB.prepare('DELETE FROM evento_equipe WHERE evento_id=? AND empresa_id=? AND auto_calculado=1')
    .bind(eventoId, auth.empresaId).run();

  let count = 0;
  for (const c of (cargos || [])) {
    const quantidade = computeCargoQty(c, contexto);
    const custo_unitario = Number(c.custo_padrao || 0);
    const custo_total = Number((quantidade * custo_unitario).toFixed(2));
    if (!quantidade || quantidade <= 0) continue;

    await env.DB.prepare(
      `INSERT INTO evento_equipe
       (evento_id, cargo_id, quantidade, custo_unitario, custo_total, auto_calculado, observacao, atualizado_em, criado_em, empresa_id)
       VALUES (?,?,?,?,?, 1, NULL, datetime('now'), datetime('now'), ?)`
    ).bind(eventoId, c.id, quantidade, custo_unitario, custo_total, auth.empresaId).run();
    count++;
  }

  return { ok: true, count };
}

async function syncEquipeToCaixa(env, auth, eventoId) {
  // Sync auto-calculated team rows to caixa_lancamentos as despesas (categoria 'equipe')
  // Idempotent by referencia = `equipe:${eventoId}:${cargo_id}`
  const ev = await env.DB.prepare(
    'SELECT id, data_evento FROM eventos WHERE id=? AND empresa_id=? AND ativo=1'
  ).bind(eventoId, auth.empresaId).first();
  if (!ev) return { ok: false };

  const dataMov = (ev.data_evento && String(ev.data_evento).slice(0,10)) || new Date().toISOString().slice(0,10);

  const { results: rows } = await env.DB.prepare(
    `SELECT ee.cargo_id, ee.quantidade, ee.custo_unitario, ee.custo_total, c.nome AS cargo_nome
     FROM evento_equipe ee
     JOIN equipe_cargos c ON c.id = ee.cargo_id AND c.empresa_id = ee.empresa_id
     WHERE ee.evento_id=? AND ee.empresa_id=? AND ee.auto_calculado=1
     ORDER BY ee.cargo_id ASC`
  ).bind(eventoId, auth.empresaId).all();

  const wantedRefs = new Set();
  for (const r of (rows || [])) {
    const cargoId = Number(r.cargo_id || 0);
    if (!cargoId) continue;
    const quantidade = Number(r.quantidade || 0);
    if (!quantidade || quantidade <= 0) continue;

    const ref = `equipe:${eventoId}:${cargoId}`;
    wantedRefs.add(ref);

    const valor = Number(r.custo_total || 0);
    const custoUnit = Number(r.custo_unitario || 0);
    const nome = r.cargo_nome || `Cargo ${cargoId}`;
    const pendente = (custoUnit <= 0) ? ' [CUSTO PENDENTE]' : '';
    const descricao = `${nome} — Equipe do Evento #${eventoId} (qtd ${quantidade})${pendente}`;

    const existing = await env.DB.prepare(
      'SELECT id FROM caixa_lancamentos WHERE empresa_id=? AND referencia=? AND ativo=1 LIMIT 1'
    ).bind(auth.empresaId, ref).first();

    if (existing?.id) {
      await env.DB.prepare(
        `UPDATE caixa_lancamentos
         SET evento_id=?, tipo='saida', categoria='equipe', descricao=?, valor=?, data_movimento=?, metodo=NULL, atualizado_em=datetime('now')
         WHERE id=? AND empresa_id=?`
      ).bind(eventoId, descricao, valor, dataMov, existing.id, auth.empresaId).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO caixa_lancamentos
         (empresa_id, evento_id, tipo, categoria, descricao, valor, data_movimento, metodo, referencia, ativo, criado_em, atualizado_em)
         VALUES (?,?,?,?,?,?,?, NULL, ?, 1, datetime('now'), datetime('now'))`
      ).bind(auth.empresaId, eventoId, 'saida', 'equipe', descricao, valor, dataMov, ref).run();
    }
  }

  // Deactivate any previous equipe refs for this event that are no longer present
  const { results: existingRefs } = await env.DB.prepare(
    `SELECT id, referencia FROM caixa_lancamentos
     WHERE empresa_id=? AND evento_id=? AND categoria='equipe' AND tipo='saida' AND ativo=1 AND referencia LIKE ?`
  ).bind(auth.empresaId, eventoId, `equipe:${eventoId}:%`).all();

  for (const e of (existingRefs || [])) {
    if (!wantedRefs.has(e.referencia)) {
      await env.DB.prepare(
        `UPDATE caixa_lancamentos SET ativo=0, atualizado_em=datetime('now') WHERE id=? AND empresa_id=?`
      ).bind(e.id, auth.empresaId).run();
    }
  }

  return { ok: true };
}


export async function eventosAPI(request, env) {
  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  // RBAC v2 (module permissions)
  const permErr = await requirePermission(env, auth, 'eventos', actionFromHttp(request.method) || 'read');
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","eventos",":id?"]
  const id = parts[2];

  try {

// EVENT TEAM (Equipe do Evento)
// GET  /api/eventos/:id/equipe        -> list current team rows
// POST /api/eventos/:id/equipe/recalcular -> recompute auto team rows from active cargos
if (id && parts[3] === 'equipe') {
  const isRecalc = parts[4] === 'recalcular';

  // Ensure event exists & belongs to tenant
  const ev = await env.DB.prepare('SELECT id, convidados, data_evento FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
    .bind(id, auth.empresaId).first();
  if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

  // LIST: GET /api/eventos/:id/equipe
  if (request.method === 'GET' && !isRecalc) {
    const equipePermErr = await requirePermission(env, auth, 'equipe', 'read');
    if (equipePermErr) return equipePermErr;

    const { results } = await env.DB.prepare(
      `SELECT id, evento_id, cargo_id, quantidade, custo_unitario, custo_total, auto_calculado, observacao, criado_em, atualizado_em
       FROM evento_equipe
       WHERE evento_id=? AND empresa_id=?
       ORDER BY cargo_id ASC`
    ).bind(id, auth.empresaId).all();
    return json({ ok: true, items: results || [] });
  }

  // RECALC: POST (recommended) or GET (convenience) /api/eventos/:id/equipe/recalcular
  if (isRecalc && (request.method === 'POST' || request.method === 'GET')) {
    const equipePermErr = await requirePermission(env, auth, 'equipe', 'update');
    if (equipePermErr) return equipePermErr;

    const res = await recomputeEventoEquipe(env, auth, id, Number(ev.convidados || 0));
    if (!res.ok) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

    // Sync to Financeiro/Caixa (Phase 3.4)
    await syncEquipeToCaixa(env, auth, Number(id));

    await logAudit(env, request, auth, { modulo: 'equipe', acao: 'recalcular', entidade: 'evento_equipe', entidadeId: Number(id) });

    const { results } = await env.DB.prepare(
      `SELECT id, evento_id, cargo_id, quantidade, custo_unitario, custo_total, auto_calculado, observacao, criado_em, atualizado_em
       FROM evento_equipe
       WHERE evento_id=? AND empresa_id=?
       ORDER BY cargo_id ASC`
    ).bind(id, auth.empresaId).all();

    return json({ ok: true, evento_id: Number(id), count: res.count || 0, items: results || [] });
  }

  return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
}




// A/R (Option B) — Generate and list parcelas for an event (Phase 3.5+)
// POST /api/eventos/:id/gerar-parcelas
if (id && parts[3] === 'gerar-parcelas' && request.method === 'POST') {
  const finPermErr = await requirePermission(env, auth, 'financeiro', 'write');
  if (finPermErr) return finPermErr;

  // Ensure finance schema exists
  const hasAR = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ar_titulos'"
  ).first();
  if (!hasAR) {
    return fail(500, 'MIGRATION_REQUIRED',
      "Financeiro precisa das migrations do PASSO 5 aplicadas no D1 (ex.: wrangler d1 migrations apply homefest-db --remote)."
    );
  }

  const ev = await env.DB.prepare(
    'SELECT id, valor_total, data_evento FROM eventos WHERE id=? AND empresa_id=? AND ativo=1'
  ).bind(id, auth.empresaId).first();
  if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

  const total = Number(ev.valor_total || 0);
  if (!(total > 0)) return fail(422, 'VALIDATION_ERROR', 'Evento sem valor_total (contrato)');

  function toIsoDate(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  }
  function addDays(iso, days) {
    const dt = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(dt.getTime())) return null;
    dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
    return dt.toISOString().slice(0, 10);
  }
  function addDaysFromToday(days) {
    const today = toIsoDate(new Date());
    return addDays(today, days);
  }
  function toCents(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }
  function fromCents(cents) {
    const n = Number(cents);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n) / 100;
  }

  const totalCents = toCents(total);
  const firstCents = Math.floor(totalCents / 2);
  const secondCents = totalCents - firstCents;

  const hoje = toIsoDate(new Date());
  const venc1 = hoje;
  let venc2 = null;
  const dataEv = ev.data_evento ? String(ev.data_evento) : null;
  if (dataEv && /^\d{4}-\d{2}-\d{2}$/.test(dataEv)) {
    // 10 days before event
    const dt = new Date(dataEv + 'T00:00:00Z');
    dt.setUTCDate(dt.getUTCDate() - 10);
    venc2 = dt.toISOString().slice(0, 10);
  } else {
    venc2 = addDaysFromToday(30);
  }

  // Ensure title exists (one active title per event)
  let titulo = await env.DB.prepare(
    "SELECT id FROM ar_titulos WHERE empresa_id=? AND evento_id=? AND ativo=1 ORDER BY id DESC LIMIT 1"
  ).bind(auth.empresaId, id).first();

  let tituloId = titulo?.id;
  if (!tituloId) {
    const ins = await env.DB.prepare(
      "INSERT INTO ar_titulos (empresa_id, evento_id, descricao, valor_total, status, ativo) VALUES (?,?,?,?, 'aberto', 1) RETURNING id"
    ).bind(auth.empresaId, id, 'Recebível (50/50 padrão)', total).first();
    tituloId = ins?.id;
  } else {
    await env.DB.prepare(
      "UPDATE ar_titulos SET valor_total=?, status='aberto', atualizado_em=datetime('now') WHERE id=? AND empresa_id=? AND ativo=1"
    ).bind(total, tituloId, auth.empresaId).run();
  }

  // Upsert parcelas 1 and 2 (do not overwrite paid parcelas)
  async function upsertParcela(numero, vencimento, valor) {
    const existing = await env.DB.prepare(
      "SELECT id, status FROM ar_parcelas WHERE empresa_id=? AND titulo_id=? AND numero=? AND ativo=1 LIMIT 1"
    ).bind(auth.empresaId, tituloId, numero).first();

    if (existing?.id) {
      if (String(existing.status || '') === 'paga') return; // preserve paid parcela
      await env.DB.prepare(
        "UPDATE ar_parcelas SET vencimento=?, valor=?, status='aberta', atualizado_em=datetime('now') WHERE id=? AND empresa_id=? AND ativo=1"
      ).bind(vencimento, Number(valor || 0), existing.id, auth.empresaId).run();
    } else {
      await env.DB.prepare(
        "INSERT INTO ar_parcelas (empresa_id, titulo_id, numero, vencimento, valor, status, ativo) VALUES (?,?,?,?,?,'aberta',1)"
      ).bind(auth.empresaId, tituloId, numero, vencimento, Number(valor || 0)).run();
    }
  }

  await upsertParcela(1, venc1, fromCents(firstCents));
  await upsertParcela(2, venc2, fromCents(secondCents));

  await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'ar_titulos', entidadeId: tituloId });
  return ok({ titulo_id: tituloId });
}

// GET /api/eventos/:id/parcelas
if (id && parts[3] === 'parcelas' && request.method === 'GET') {
  const finPermErr = await requirePermission(env, auth, 'financeiro', 'read');
  if (finPermErr) return finPermErr;

  const hasAR = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='ar_titulos'"
  ).first();
  if (!hasAR) return json([]); // fail-open: no schema yet

  const titulo = await env.DB.prepare(
    "SELECT id FROM ar_titulos WHERE empresa_id=? AND evento_id=? AND ativo=1 ORDER BY id DESC LIMIT 1"
  ).bind(auth.empresaId, id).first();
  if (!titulo?.id) return json([]);

  const { results } = await env.DB.prepare(
    "SELECT id, numero, vencimento, valor, status, pago_em, forma_pagamento, observacao FROM ar_parcelas WHERE empresa_id=? AND titulo_id=? AND ativo=1 ORDER BY numero ASC, id ASC"
  ).bind(auth.empresaId, titulo.id).all();
  return json(results || []);
}

  
// EVENT FINANCIAL SUMMARY (Phase 3.5)
// GET /api/eventos/:id/resumo-financeiro
if (id && parts[3] === 'resumo-financeiro') {
  // Require financeiro:read because this exposes sensitive values
  const finPermErr = await requirePermission(env, auth, 'financeiro', 'read');
  if (finPermErr) return finPermErr;

  const ev = await env.DB.prepare(
    'SELECT id, valor_total, data_evento FROM eventos WHERE id=? AND empresa_id=? AND ativo=1'
  ).bind(id, auth.empresaId).first();
  if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

  // Caixa totals (cashflow)
  const caixa = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE 0 END),0) AS entradas_total,
        COALESCE(SUM(CASE WHEN tipo='saida' THEN valor ELSE 0 END),0) AS saidas_total,
        COALESCE(SUM(CASE WHEN tipo='saida' AND categoria='equipe' THEN valor ELSE 0 END),0) AS custo_equipe,
        COALESCE(SUM(CASE WHEN tipo='saida' AND (categoria IS NULL OR categoria<>'equipe') THEN valor ELSE 0 END),0) AS custo_operacional
       FROM caixa_lancamentos
       WHERE empresa_id=? AND evento_id=? AND ativo=1`
  ).bind(auth.empresaId, id).first();

  // Recebíveis (A/R) — optional, only if PASSO 5 migrations were applied
  let parcelas_total = null;
  let parcelas_pagas_total = null;
  try {
    const hasAR = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ar_titulos'"
    ).first();
    if (hasAR) {
      const ar = await env.DB.prepare(
        `SELECT
            COALESCE(SUM(CASE WHEN p.ativo=1 THEN p.valor ELSE 0 END),0) AS parcelas_total,
            COALESCE(SUM(CASE WHEN p.ativo=1 AND p.status='paga' THEN p.valor ELSE 0 END),0) AS parcelas_pagas_total
         FROM ar_titulos t
         JOIN ar_parcelas p ON p.titulo_id=t.id AND p.empresa_id=t.empresa_id
         WHERE t.empresa_id=? AND t.evento_id=? AND t.ativo=1`
      ).bind(auth.empresaId, id).first();
      parcelas_total = Number(ar?.parcelas_total || 0);
      parcelas_pagas_total = Number(ar?.parcelas_pagas_total || 0);
    }
  } catch {
    // fail-open: still return caixa-based summary
  }

  const entradas_total = Number(caixa?.entradas_total || 0);
  const saidas_total = Number(caixa?.saidas_total || 0);
  const custo_equipe = Number(caixa?.custo_equipe || 0);
  const custo_operacional = Number(caixa?.custo_operacional || 0);

  // Base revenue for "lucro_estimado" should be contractual value when available; fallback to cash received.
  const receita_contratada = Number(ev.valor_total || 0);
  const receita_base = (receita_contratada > 0) ? receita_contratada : entradas_total;
  const receita_base_tipo = (receita_contratada > 0) ? 'contrato' : 'caixa';

  const lucro_estimado = Number((receita_base - saidas_total).toFixed(2));
  const margem_percentual = (receita_base > 0)
    ? Number(((lucro_estimado / receita_base) * 100).toFixed(2))
    : 0;


  // Recebido / a receber (Option B when A/R exists; fallback to caixa/contrato)
  let recebido_total = 0;
  let a_receber_total = 0;
  if (parcelas_total !== null && parcelas_pagas_total !== null) {
    recebido_total = Number(parcelas_pagas_total || 0);
    a_receber_total = Number(Math.max(Number(parcelas_total || 0) - recebido_total, 0).toFixed(2));
  } else {
    recebido_total = entradas_total;
    a_receber_total = (receita_contratada > 0)
      ? Number(Math.max(receita_contratada - entradas_total, 0).toFixed(2))
      : 0;
  }


  return json({
    ok: true,
    evento_id: Number(id),
    receita_contratada,
    receita_base,
    receita_base_tipo,
    entradas_total,
    saidas_total,
    custo_equipe,
    custo_operacional,
    lucro_estimado,
    margem_percentual,
    recebido_total,
    a_receber_total,
    pagamentos: (parcelas_total === null) ? null : {
      parcelas_total,
      parcelas_pagas_total
    }
  });
}

// PROPOSALS (linked to event)
// /api/eventos/:id/propostas
  if (id && parts[3] === 'propostas') {
    // RBAC (propostas module)
    const propAction = actionFromHttp(request.method) || 'read';
    const propPermErr = await requirePermission(env, auth, 'propostas', propAction);
    if (propPermErr) return propPermErr;
    // LIST proposals for event
    if (request.method === 'GET') {
      const exists = await env.DB.prepare('SELECT id FROM eventos WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
      if (!exists) return fail(404, 'NOT_FOUND', 'Evento não encontrado');
      const { results } = await env.DB.prepare(
        'SELECT id, evento_id, versao, titulo, status, created_at FROM propostas WHERE evento_id=? ORDER BY versao DESC'
      ).bind(id).all();
      return json(results);
    }

    // CREATE a new proposal version for event
    if (request.method === 'POST') {
      const exists = await env.DB.prepare('SELECT id FROM eventos WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
      if (!exists) return fail(404, 'NOT_FOUND', 'Evento não encontrado');
      const parsed = await safeJsonBody(request);
      if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
      const b = parsed.body;
      const payload = {
        // Snapshot payload: immutable after creation (new versions are new rows)
        schema: 'hf_proposta_v1',
        titulo: (b.titulo || 'Proposta Comercial').trim(),
        items: Array.isArray(b.items) ? b.items : [],
        desconto: Number(b.desconto || 0),
        observacoes: (b.observacoes || '').trim(),
        condicoes: (b.condicoes || '').trim(),
        validade: (b.validade || '').trim(),
        // Contract-inspired commercial defaults (can be overridden explicitly)
        termos: {
          // Excedentes & duração (defaults from contracts; override per proposal if needed)
          convidado_excedente_valor: Number(b?.termos?.convidado_excedente_valor ?? 150),
          excedentes_percentual_cortesia: Number(b?.termos?.excedentes_percentual_cortesia ?? 5),
          idade_pagante_a_partir: Number(b?.termos?.idade_pagante_a_partir ?? 5),
          duracao_horas: Number(b?.termos?.duracao_horas ?? 4),
          tolerancia_min: Number(b?.termos?.tolerancia_min ?? 30),
          hora_extra_valor: Number(b?.termos?.hora_extra_valor ?? 2500),
          pagamento: {
            entrada_percentual: Number(b?.termos?.pagamento?.entrada_percentual ?? 50),
            saldo_dias_antes_evento: Number(b?.termos?.pagamento?.saldo_dias_antes_evento ?? 7),
          },
          rescisao: {
            retencao_desistencia_contratante_percentual: Number(b?.termos?.rescisao?.retencao_desistencia_contratante_percentual ?? 20),
            multa_desistencia_contratada_percentual: Number(b?.termos?.rescisao?.multa_desistencia_contratada_percentual ?? 10),
            remarcacao_antecedencia_dias: Number(b?.termos?.rescisao?.remarcacao_antecedencia_dias ?? 15),
          },
          quebras: {
            pagamento_imediato: true,
            meios: ['PIX','dinheiro','outro'],
          }
        },
        snapshot_meta: {
          created_at: new Date().toISOString(),
          created_by_user_id: auth?.userId ?? null,
          created_by_name: auth?.nome ?? null
        }
      };

      // UX defaults: if user didn't type conditions/validity, prefill with contract standard
      if (!payload.condicoes) {
        payload.condicoes = '50% de entrada e 50% até 01 semana antes do evento.';
      }
      if (!payload.validade) {
        payload.validade = '7 dias a partir do envio.';
      }

      // Determine next version
      const row = await env.DB.prepare('SELECT COALESCE(MAX(versao), 0) AS v FROM propostas WHERE evento_id=?').bind(id).first();
      const nextV = (row?.v || 0) + 1;

      const titulo = payload.titulo;
      const status = (b.status || 'rascunho').trim() || 'rascunho';

      const ins = await env.DB.prepare(
        'INSERT INTO propostas (evento_id, versao, titulo, status, payload_json) VALUES (?,?,?,?,?)'
      ).bind(id, nextV, titulo, status, JSON.stringify(payload)).run();

      await logAudit(env, request, auth, { modulo: 'propostas', acao: 'create', entidade: 'propostas', entidadeId: ins.meta.last_row_id });
      return ok({ id: ins.meta.last_row_id, versao: nextV });
    }

    return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }



  // LIST
  if (request.method === 'GET' && !id) {
    // Optional filters (stable + backward compatible)
    const status = url.searchParams.get('status');
    const clienteId = url.searchParams.get('cliente_id');
    const qText = (url.searchParams.get('q') || '').trim().toLowerCase();

    let q = `
      SELECT e.*,
        (SELECT nome FROM clientes c WHERE c.id = e.cliente_id AND c.empresa_id = e.empresa_id AND c.ativo=1) AS cliente_nome
      FROM eventos e
    `;
    const where = ['e.empresa_id = ?', 'e.ativo = 1'];
    const binds = [auth.empresaId];

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
    const evento = await env.DB.prepare('SELECT * FROM eventos WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!evento) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=? AND ativo=1').bind(evento.cliente_id, auth.empresaId).first();
    return json({ evento, cliente });
  }

  // CREATE
  if (request.method === 'POST' && !id) {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const b = parsed.body;
    if (!b.cliente_id) return fail(422, 'VALIDATION_ERROR', 'cliente_id é obrigatório');

    const cliente = await env.DB.prepare('SELECT id FROM clientes WHERE id=? AND empresa_id=? AND ativo=1').bind(b.cliente_id, auth.empresaId).first();
    if (!cliente) return fail(404, 'NOT_FOUND', 'Cliente não encontrado');

    const ins = await env.DB.prepare(`
      INSERT INTO eventos (empresa_id, cliente_id, tipo_evento, data_evento, convidados, valor_total, status, forma_pagamento, contrato_numero, ativo, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
    `).bind(
      auth.empresaId,
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
      await env.DB.prepare('UPDATE eventos SET contrato_numero=?, atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=?').bind(contrato_numero, newId, auth.empresaId).run();
    }

    await logAudit(env, request, auth, { modulo: 'eventos', acao: 'create', entidade: 'eventos', entidadeId: newId });

    return ok({ id: newId, contrato_numero });
  }

  
// UPDATE (PATCH/PUT)
if ((request.method === 'PATCH' || request.method === 'PUT') && id) {
  const parsed = await safeJsonBody(request);
  if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
  const b = parsed.body;

  const exists = await env.DB.prepare('SELECT id, convidados FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
    .bind(id, auth.empresaId).first();
  if (!exists) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

  const oldConvidados = Number(exists.convidados || 0);

  const allow = ['cliente_id','tipo_evento','data_evento','convidados','valor_total','status','forma_pagamento','contrato_numero'];
  const fields = [];
  const binds = [];

  for (const k of allow) {
    if (b[k] !== undefined) {
      fields.push(`${k}=?`);
      binds.push(b[k]);
    }
  }

  if (!fields.length) return fail(422, 'VALIDATION_ERROR', 'Nada para atualizar');

  binds.push(id);
  await env.DB.prepare(`UPDATE eventos SET ${fields.join(', ')}, atualizado_em=datetime('now') WHERE id=? AND empresa_id=? AND ativo=1`)
    .bind(...binds, auth.empresaId).run();

  // Auto-recompute event team when convidados changed (derived data must stay consistent)
  if (b.convidados !== undefined) {
    const newConvidados = Number(b.convidados || 0);
    if (isFinite(newConvidados) && newConvidados !== oldConvidados) {
      const rr = await recomputeEventoEquipe(env, auth, id, newConvidados);
      if (rr?.ok) await syncEquipeToCaixa(env, auth, Number(id));
    }
  }

  await logAudit(env, request, auth, { modulo: 'eventos', acao: 'update', entidade: 'eventos', entidadeId: id });
  return ok();
}

  // DELETE
  if (request.method === 'DELETE' && id) {
    await env.DB.prepare('UPDATE eventos SET ativo=0, atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=?').bind(id, auth.empresaId).run();
    await logAudit(env, request, auth, { modulo: 'eventos', acao: 'delete', entidade: 'eventos', entidadeId: id });
    return ok();
  }

  return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');

  } catch (err) {
    return fail(500, 'INTERNAL_ERROR', 'Erro interno', String(err?.message || err));
  }
}
