import { json, ok, fail, getAuth, requireTenant, safeJsonBody, asInt } from '../utils/api.js';
import { logAudit } from '../utils/audit.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';
import { CUSTO_PRESETS } from '../utils/custos_presets.js';

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

function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}
function fromCents(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}
function splitCents(totalCents, parts) {
  const p = Number(parts);
  if (!Number.isFinite(p) || p <= 0) return [];
  const base = Math.floor(totalCents / p);
  const rem = totalCents - base * p;
  const out = Array(p).fill(base);
  // distribute remainder 1 cent each
  for (let i = 0; i < rem; i++) out[i] += 1;
  return out;
}


async function ensureFinanceSchema(env) {
  // Defensive: D1 migrations are not applied automatically on deploy.
  // If tables don't exist yet, return a clear error instead of a generic 500.
  const required = ['ar_titulos', 'ar_parcelas', 'ap_contas', 'caixa_lancamentos'];
  for (const t of required) {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).bind(t).first();
    if (!row) {
      return fail(500, 'MIGRATION_REQUIRED',
        "Financeiro precisa das migrations do PASSO 5 aplicadas no D1 (ex.: wrangler d1 migrations apply <DB_NAME> --remote)."
      );
    }
  }
  return null;
}

async function assertEvento(env, empresaId, eventoId) {
  const eid = asInt(eventoId, null);
  if (!eid) return { ok: false, resp: fail(422, 'VALIDATION_ERROR', 'evento_id inválido') };
  const ev = await env.DB
    .prepare('SELECT id, data_evento, valor_total FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
    .bind(eid, empresaId)
    .first();
  if (!ev) return { ok: false, resp: fail(404, 'NOT_FOUND', 'Evento não encontrado') };
  return { ok: true, evento: ev };
}

// Compute a caixa summary in a single request/colo to avoid read-after-write issues.
// This is important on distributed D1 where immediate subsequent reads may be stale.
async function getCaixaResumo(env, empresaId, { from = null, to = null, limit = 50 } = {}) {
  const lim = Math.min(Math.max(asInt(limit, 50) || 50, 1), 200);
  const binds = [empresaId];
  let where = "WHERE empresa_id=? AND ativo=1";
  if (from) { where += " AND data_movimento>=?"; binds.push(from); }
  if (to) { where += " AND data_movimento<=?"; binds.push(to); }

  const saldoRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) AS saldo
       FROM caixa_lancamentos
      ${where}`
  ).bind(...binds).first();

  const totRow = await env.DB.prepare(
    `SELECT 
        COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor END),0) AS entradas,
        COALESCE(SUM(CASE WHEN tipo='saida' THEN valor END),0) AS saidas
       FROM caixa_lancamentos
      ${where}`
  ).bind(...binds).first();

  const listBinds = binds.slice();
  listBinds.push(lim);
  const { results } = await env.DB.prepare(
    `SELECT * FROM caixa_lancamentos
      ${where}
      ORDER BY data_movimento DESC, id DESC
      LIMIT ?`
  ).bind(...listBinds).all();

  return {
    saldo: Number(saldoRow?.saldo || 0),
    entradas: Number(totRow?.entradas || 0),
    saidas: Number(totRow?.saidas || 0),
    items: results,
  };
}

export async function financeiroAPI(request, env) {
  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  // RBAC v2 (module permissions)
  const permErr = await requirePermission(env, auth, 'financeiro', actionFromHttp(request.method) || 'read');
  if (permErr) return permErr;

  try {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean); // ["api","financeiro", ...]
    const sub = parts[2] || '';
const schemaErr = (sub === 'ar' || sub === 'ap' || sub === 'resumo' || sub === 'custos' || sub === 'caixa') ? await ensureFinanceSchema(env) : null;
    if (schemaErr) return schemaErr;

    
    // ----------------------------
    // PASSO 5 — Financeiro real
    // ----------------------------

    // A/R (contas a receber)
    if (sub === 'ar') {
      const kind = parts[3] || '';
      const id = parts[4] || '';

      // GET /api/financeiro/ar?evento_id=...
      if (request.method === 'GET' && !kind) {
        const eventoId = url.searchParams.get('evento_id');
        const binds = [auth.empresaId];
        let q = `SELECT t.*,
                        (SELECT COUNT(1) FROM ar_parcelas p WHERE p.titulo_id=t.id AND p.empresa_id=? AND p.ativo=1) AS parcelas,
                        (SELECT COALESCE(SUM(CASE WHEN p.status='paga' THEN p.valor ELSE 0 END),0) FROM ar_parcelas p WHERE p.titulo_id=t.id AND p.empresa_id=? AND p.ativo=1) AS total_pago
                   FROM ar_titulos t
                  WHERE t.empresa_id=? AND t.ativo=1`;
        binds.push(auth.empresaId, auth.empresaId);
        if (eventoId) { q += ' AND t.evento_id=?'; binds.push(asInt(eventoId, 0)); }
        q += ' ORDER BY t.id DESC';
        const { results } = await env.DB.prepare(q).bind(...binds).all();
        return json(results);
      }

      // GET /api/financeiro/ar/parcelas?titulo_id=...
      if (request.method === 'GET' && kind === 'parcelas') {
        const tituloId = url.searchParams.get('titulo_id');
        if (!tituloId) return fail(422, 'VALIDATION_ERROR', 'titulo_id é obrigatório');
        const { results } = await env.DB
          .prepare(`SELECT * FROM ar_parcelas WHERE empresa_id=? AND titulo_id=? AND ativo=1 ORDER BY numero ASC`)
          .bind(auth.empresaId, asInt(tituloId, 0))
          .all();
        return json(results);
      }

      // POST /api/financeiro/ar/titulos  { evento_id, contrato_id?, descricao?, valor_total, parcelas:[{vencimento,valor}] }
      if (request.method === 'POST' && kind === 'titulos') {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};
        const evCheck = await assertEvento(env, auth.empresaId, b.evento_id);
        if (!evCheck.ok) return evCheck.resp;

        const totalCents = toCents(b.valor_total);
        if (!Number.isFinite(totalCents) || totalCents <= 0) return fail(422, 'VALIDATION_ERROR', 'valor_total inválido');

        // Normalize parcelas
        let parcelasIn = Array.isArray(b.parcelas) ? b.parcelas : [];
        let parcelas = [];
        if (parcelasIn.length === 0) {
          const venc = toIsoDate(new Date()) || toIsoDate(evCheck.evento.data_evento) || toIsoDate(new Date());
          parcelas = [{ numero: 1, vencimento: venc, valor: fromCents(totalCents) }];
        } else {
          let n = 1;
          let sum = 0;
          for (const p of parcelasIn) {
            const venc = toIsoDate(p?.vencimento);
            const cents = toCents(p?.valor);
            if (!venc || !Number.isFinite(cents) || cents <= 0) continue;
            parcelas.push({ numero: n, vencimento: venc, valor: fromCents(cents) });
            sum += cents;
            n += 1;
          }
          if (parcelas.length === 0) {
            const venc = toIsoDate(new Date());
            parcelas = [{ numero: 1, vencimento: venc, valor: fromCents(totalCents) }];
          } else {
            // If sums don't match, fail closed (integrity)
            if (sum !== totalCents) {
              return fail(422, 'VALIDATION_ERROR', 'A soma das parcelas deve ser igual ao valor_total (sem diferença de centavos).');
            }
          }
        }

        // Atomic insert using a single statement (CTE) so title+parcelas are ACID
        const valuesSql = parcelas.map(() => '(?,?,?)').join(', ');
        const sql = `
          WITH new_title AS (
            INSERT INTO ar_titulos (empresa_id, evento_id, contrato_id, descricao, valor_total, status, ativo, criado_em, atualizado_em)
            VALUES (?,?,?,?,?, 'aberto', 1, datetime('now'), datetime('now'))
            RETURNING id
          )
          INSERT INTO ar_parcelas (empresa_id, titulo_id, numero, vencimento, valor, status, ativo, criado_em, atualizado_em)
          SELECT ?, new_title.id, v.numero, v.vencimento, v.valor, 'aberta', 1, datetime('now'), datetime('now')
            FROM new_title
            JOIN (VALUES ${valuesSql}) AS v(numero, vencimento, valor)
          RETURNING titulo_id
        `;
        const binds = [
          auth.empresaId,
          asInt(b.evento_id, 0),
          b.contrato_id ? asInt(b.contrato_id, 0) : null,
          b.descricao || 'Recebível do evento',
          fromCents(totalCents),
          auth.empresaId,
        ];
        for (const p of parcelas) binds.push(p.numero, p.vencimento, p.valor);

        const row = await env.DB.prepare(sql).bind(...binds).first();
        const tituloId = row?.titulo_id;

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'ar_titulos', entidadeId: tituloId });
        return ok({ id: tituloId });
      }

      // POST /api/financeiro/ar/gerar-padrao { evento_id, valor_total? }
      if (request.method === 'POST' && kind === 'gerar-padrao') {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};
        const evCheck = await assertEvento(env, auth.empresaId, b.evento_id);
        if (!evCheck.ok) return evCheck.resp;

        const baseCents = toCents(b.valor_total ?? evCheck.evento.valor_total ?? 0);
        if (!Number.isFinite(baseCents) || baseCents <= 0) {
          return fail(422, 'VALIDATION_ERROR', 'Informe valor_total (ou preencha valor_total no evento)');
        }

        const hoje = toIsoDate(new Date());
        const dataEvento = toIsoDate(evCheck.evento.data_evento);
        const venc2 = dataEvento ? addDays(dataEvento, -7) : addDays(hoje, 7);

        const parts = splitCents(baseCents, 2);
        const v1 = fromCents(parts[0]);
        const v2 = fromCents(parts[1]);

        const sql = `
          WITH new_title AS (
            INSERT INTO ar_titulos (empresa_id, evento_id, contrato_id, descricao, valor_total, status, ativo, criado_em, atualizado_em)
            VALUES (?,?,?,?,?, 'aberto', 1, datetime('now'), datetime('now'))
            RETURNING id
          )
          INSERT INTO ar_parcelas (empresa_id, titulo_id, numero, vencimento, valor, status, ativo, criado_em, atualizado_em)
          SELECT ?, new_title.id, v.numero, v.vencimento, v.valor, 'aberta', 1, datetime('now'), datetime('now')
            FROM new_title
            JOIN (VALUES (1, ?, ?), (2, ?, ?)) AS v(numero, vencimento, valor)
          RETURNING titulo_id
        `;
        const row = await env.DB.prepare(sql).bind(
          auth.empresaId,
          asInt(b.evento_id, 0),
          b.contrato_id ? asInt(b.contrato_id, 0) : null,
          'Recebível (50/50 padrão)',
          fromCents(baseCents),
          auth.empresaId,
          hoje, v1,
          venc2, v2
        ).first();

        const tituloId = row?.titulo_id;
        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'ar_titulos', entidadeId: tituloId });
        return ok({ id: tituloId });
      }

      // PUT /api/financeiro/ar/parcela/:id  { status, pago_em?, forma_pagamento? }
      if (request.method === 'PUT' && kind === 'parcela' && id) {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};
        const status = String(b.status || '').toLowerCase();
        if (!['aberta','paga','cancelada'].includes(status)) {
          return fail(422, 'VALIDATION_ERROR', 'status inválido');
        }
        const pagoEm = status === 'paga' ? (toIsoDate(b.pago_em) || toIsoDate(new Date())) : null;
        const forma = status === 'paga' ? (b.forma_pagamento || null) : null;

        await env.DB.prepare(`
          UPDATE ar_parcelas
             SET status=?, pago_em=?, forma_pagamento=?, atualizado_em=datetime('now')
           WHERE id=? AND empresa_id=? AND ativo=1
        `).bind(status, pagoEm, forma, asInt(id, 0), auth.empresaId).run();


        // Sync Caixa (idempotent) — Option B: when parcela is paid, create/update caixa entry.
        // referencia = pagamento:{parcela_id}
        try {
          const pinfo = await env.DB.prepare(
            `SELECT p.id AS parcela_id, p.numero, p.valor, p.status, p.pago_em, p.forma_pagamento,
                    t.evento_id
               FROM ar_parcelas p
               JOIN ar_titulos t ON t.id=p.titulo_id AND t.empresa_id=p.empresa_id
              WHERE p.id=? AND p.empresa_id=? AND p.ativo=1 AND t.ativo=1`
          ).bind(asInt(id, 0), auth.empresaId).first();

          if (pinfo?.evento_id) {
            const ref = `pagamento:${pinfo.parcela_id}`;
            const existing = await env.DB.prepare(
              'SELECT id FROM caixa_lancamentos WHERE empresa_id=? AND referencia=? LIMIT 1'
            ).bind(auth.empresaId, ref).first();

            if (String(pinfo.status || '') === 'paga') {
              const dataMov = toIsoDate(pinfo.pago_em) || toIsoDate(new Date());
              const desc = `Recebimento parcela ${Number(pinfo.numero || 0)} (evento ${Number(pinfo.evento_id)})`;

              if (existing?.id) {
                await env.DB.prepare(
                  `UPDATE caixa_lancamentos
                      SET evento_id=?, tipo='entrada', categoria='recebimento', descricao=?, valor=?, data_movimento=?, metodo=?, ativo=1, atualizado_em=datetime('now')
                    WHERE id=? AND empresa_id=?`
                ).bind(
                  asInt(pinfo.evento_id, 0),
                  desc,
                  Number(pinfo.valor || 0),
                  dataMov,
                  pinfo.forma_pagamento || null,
                  asInt(existing.id, 0),
                  auth.empresaId
                ).run();
              } else {
                await env.DB.prepare(
                  `INSERT INTO caixa_lancamentos (empresa_id, evento_id, tipo, categoria, descricao, valor, data_movimento, metodo, referencia, ativo)
                   VALUES (?,?,?,?,?,?,?,?,?,1)`
                ).bind(
                  auth.empresaId,
                  asInt(pinfo.evento_id, 0),
                  'entrada',
                  'recebimento',
                  desc,
                  Number(pinfo.valor || 0),
                  dataMov,
                  pinfo.forma_pagamento || null,
                  ref
                ).run();
              }
            } else {
              // If parcela is not paid anymore (aberta/cancelada), deactivate caixa entry if it exists.
              if (existing?.id) {
                await env.DB.prepare(
                  `UPDATE caixa_lancamentos SET ativo=0, atualizado_em=datetime('now')
                    WHERE id=? AND empresa_id=?`
                ).bind(asInt(existing.id, 0), auth.empresaId).run();
              }
            }
          }
        } catch (_) { /* best-effort */ }


        // Automação: se todas parcelas do título estiverem pagas, marcar título como quitado (senão, aberto)
        try {
          const t = await env.DB.prepare(
            "SELECT titulo_id FROM ar_parcelas WHERE id=? AND empresa_id=? AND ativo=1"
          ).bind(asInt(id, 0), auth.empresaId).first();
          if (t?.titulo_id) {
            const unpaid = await env.DB.prepare(
              "SELECT COUNT(1) AS c FROM ar_parcelas WHERE titulo_id=? AND empresa_id=? AND ativo=1 AND status!='paga'"
            ).bind(t.titulo_id, auth.empresaId).first();
            const allPaid = Number(unpaid?.c || 0) === 0;
            await env.DB.prepare(
              "UPDATE ar_titulos SET status=?, atualizado_em=datetime('now') WHERE id=? AND empresa_id=? AND ativo=1"
            ).bind(allPaid ? 'quitado' : 'aberto', t.titulo_id, auth.empresaId).run();
          }
        } catch (_) { /* best-effort */ }

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'update', entidade: 'ar_parcelas', entidadeId: id });
        return ok();
      }

      return fail(404, 'NOT_FOUND', 'Rota não encontrada');
    }

    // A/P (contas a pagar)
    if (sub === 'ap') {
      const id = parts[3] || '';

      // GET /api/financeiro/ap?evento_id=...
      if (request.method === 'GET' && !id) {
        const eventoId = url.searchParams.get('evento_id');
        let q = 'SELECT * FROM ap_contas WHERE empresa_id=? AND ativo=1';
        const binds = [auth.empresaId];
        if (eventoId) { q += ' AND evento_id=?'; binds.push(asInt(eventoId, 0)); }
        q += ' ORDER BY vencimento ASC, id DESC';
        const { results } = await env.DB.prepare(q).bind(...binds).all();
        return json(results);
      }

      // POST /api/financeiro/ap { evento_id, descricao, valor, vencimento, fornecedor?, categoria?, evento_item_id? }
      if (request.method === 'POST' && !id) {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};
        const evCheck = await assertEvento(env, auth.empresaId, b.evento_id);
        if (!evCheck.ok) return evCheck.resp;

        const desc = String(b.descricao || '').trim();
        const valorCents = toCents(b.valor);
        const valor = fromCents(valorCents);
        const venc = toIsoDate(b.vencimento);
        if (!desc) return fail(422, 'VALIDATION_ERROR', 'descricao é obrigatório');
        if (valorCents == null || valor <= 0) return fail(422, 'VALIDATION_ERROR', 'valor inválido');
        if (!venc) return fail(422, 'VALIDATION_ERROR', 'vencimento inválido');

        const ins = await env.DB.prepare(`
          INSERT INTO ap_contas (empresa_id, evento_id, evento_item_id, fornecedor, categoria, descricao, vencimento, valor, status, ativo, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?, ?, 'aberta', 1, datetime('now'), datetime('now'))
        `).bind(
          auth.empresaId,
          asInt(b.evento_id, 0),
          b.evento_item_id ? asInt(b.evento_item_id, 0) : null,
          b.fornecedor || null,
          b.categoria || null,
          desc,
          venc,
          valor
        ).run();

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'ap_contas', entidadeId: ins.meta.last_row_id });
        return ok({ id: ins.meta.last_row_id });
      }

      // PUT /api/financeiro/ap/:id { status, pago_em?, forma_pagamento? }
      if (request.method === 'PUT' && id) {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};
        const status = String(b.status || '').toLowerCase();
        if (!['aberta','paga','cancelada'].includes(status)) return fail(422, 'VALIDATION_ERROR', 'status inválido');

        const pagoEm = status === 'paga' ? (toIsoDate(b.pago_em) || toIsoDate(new Date())) : null;
        const forma = status === 'paga' ? (b.forma_pagamento || null) : null;

        await env.DB.prepare(`
          UPDATE ap_contas
             SET status=?, pago_em=?, forma_pagamento=?, atualizado_em=datetime('now')
           WHERE id=? AND empresa_id=? AND ativo=1
        `).bind(status, pagoEm, forma, asInt(id, 0), auth.empresaId).run();

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'update', entidade: 'ap_contas', entidadeId: id });
        return ok();
      }

      // DELETE /api/financeiro/ap/:id
      if (request.method === 'DELETE' && id) {
        await env.DB.prepare(`UPDATE ap_contas SET ativo=0, atualizado_em=datetime('now') WHERE id=? AND empresa_id=?`).bind(asInt(id, 0), auth.empresaId).run();
        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'delete', entidade: 'ap_contas', entidadeId: id });
        return ok();
      }

      return fail(404, 'NOT_FOUND', 'Rota não encontrada');
    }

    // Custos: preset baseado na planilha (insere em evento_itens)
    if (sub === 'custos' && request.method === 'POST' && parts[3] === 'preset') {
      const parsed = await safeJsonBody(request);
      if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
      const b = parsed.body || {};
      const evCheck = await assertEvento(env, auth.empresaId, b.evento_id);
      if (!evCheck.ok) return evCheck.resp;

      const presetKey = String(b.preset || '').trim();
      if (!presetKey || !CUSTO_PRESETS[presetKey]) {
        return fail(422, 'VALIDATION_ERROR', 'preset inválido');
      }
      const items = CUSTO_PRESETS[presetKey] || [];
      if (items.length === 0) return ok({ inserted: 0 });

      // Option: prevent duplicates by checking if there are existing items for the evento.
      const existing = await env.DB.prepare('SELECT COUNT(1) as n FROM evento_itens WHERE empresa_id=? AND evento_id=? AND ativo=1').bind(auth.empresaId, asInt(b.evento_id, 0)).first();
      if (existing && Number(existing.n) > 0 && b.force !== true) {
        return fail(409, 'CONFLICT', 'Evento já possui itens de custo. Use force=true para inserir mesmo assim.');
      }

      let inserted = 0;
      const stmt = env.DB.prepare(`
        INSERT INTO evento_itens (empresa_id, evento_id, categoria, item, quantidade, unidade, fornecedor, valor_unitario, valor_total, status, observacao, ativo, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
      `);
      for (const it of items) {
        await stmt.bind(
          auth.empresaId,
          asInt(b.evento_id, 0),
          it.categoria || 'Geral',
          it.item,
          Number(it.quantidade || 0),
          it.unidade || null,
          it.fornecedor || null,
          Number(it.valor_unitario || 0),
          Number(it.valor_total || 0),
          it.status || 'pendente',
          it.observacao || null
        ).run();
        inserted += 1;
      }
      await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'evento_itens', entidadeId: asInt(b.evento_id, 0) });
      return ok({ inserted });
    }

    // Resumo por evento (receber/pagar/custos)
    if (sub === 'resumo' && request.method === 'GET') {
      const eventoId = url.searchParams.get('evento_id');
      const evCheck = await assertEvento(env, auth.empresaId, eventoId);
      if (!evCheck.ok) return evCheck.resp;

      const eid = asInt(eventoId, 0);

      const ar = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(p.valor),0) AS receber_previsto,
          COALESCE(SUM(CASE WHEN p.status='paga' THEN p.valor ELSE 0 END),0) AS receber_realizado
        FROM ar_parcelas p
        JOIN ar_titulos t ON t.id=p.titulo_id
       WHERE p.empresa_id=? AND t.empresa_id=? AND t.evento_id=? AND p.ativo=1 AND t.ativo=1
      `).bind(auth.empresaId, auth.empresaId, eid).first();

      const ap = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(valor),0) AS pagar_previsto,
          COALESCE(SUM(CASE WHEN status='paga' THEN valor ELSE 0 END),0) AS pagar_realizado
        FROM ap_contas
       WHERE empresa_id=? AND evento_id=? AND ativo=1
      `).bind(auth.empresaId, eid).first();

      const custos = await env.DB.prepare(`
        SELECT
          COALESCE(SUM(valor_total),0) AS custos_planejados
        FROM evento_itens
       WHERE empresa_id=? AND evento_id=? AND ativo=1
      `).bind(auth.empresaId, eid).first();

      const receberPrev = Number(ar?.receber_previsto || 0);
      const receberReal = Number(ar?.receber_realizado || 0);
      const pagarPrev = Number(ap?.pagar_previsto || 0);
      const pagarReal = Number(ap?.pagar_realizado || 0);
      const custosPlan = Number(custos?.custos_planejados || 0);

      return ok({
        evento_id: eid,
        receber_previsto: receberPrev,
        receber_realizado: receberReal,
        pagar_previsto: pagarPrev,
        pagar_realizado: pagarReal,
        custos_planejados: custosPlan,
        margem_prevista: receberPrev - custosPlan,
        caixa_real: receberReal - pagarReal
      });
    }

    // ----------------------------
    // Legado: /api/financeiro (lançamentos simples)
    // ----------------------------
    // GET /api/financeiro
    if (request.method === 'GET' && parts.length === 2) {
      const eventoId = url.searchParams.get('evento_id');
      let q = 'SELECT * FROM financeiro WHERE empresa_id=? AND ativo=1';
      const binds = [auth.empresaId];
      if (eventoId) { q += ' AND evento_id=?'; binds.push(eventoId); }
      q += ' ORDER BY id DESC';
      const { results } = await env.DB.prepare(q).bind(...binds).all();
      return json(results);
    }

    
    // ----------------------------
    // Caixa da empresa (ledger)
    // ----------------------------
    if (sub === 'caixa') {
      const id = parts[3] || '';

      // GET /api/financeiro/caixa?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50
      if (request.method === 'GET' && !id) {
        const from = toIsoDate(url.searchParams.get('from')) || null;
        const to = toIsoDate(url.searchParams.get('to')) || null;
        const limit = asInt(url.searchParams.get('limit'), 50) || 50;
        const resumo = await getCaixaResumo(env, auth.empresaId, { from, to, limit });
        return ok(resumo);
      }

      // POST /api/financeiro/caixa  { tipo: 'entrada'|'saida', categoria, valor, data_movimento?, descricao?, metodo?, evento_id? }
      if (request.method === 'POST' && !id) {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};
        const tipo = String(b.tipo || '').toLowerCase();
        if (!['entrada','saida'].includes(tipo)) return fail(422, 'VALIDATION_ERROR', 'tipo inválido');
        const categoria = String(b.categoria || 'outros');
        const valorCents = toCents(b.valor);
        const valor = fromCents(valorCents);
        if (valorCents == null || valor <= 0) return fail(422, 'VALIDATION_ERROR', 'valor inválido');

        const dataMov = toIsoDate(b.data_movimento) || toIsoDate(new Date());
        const eventoId = b.evento_id ? asInt(b.evento_id, 0) : null;
        if (eventoId) {
          const ev = await env.DB.prepare('SELECT id FROM eventos WHERE id=? AND empresa_id=? AND ativo=1').bind(eventoId, auth.empresaId).first();
          if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');
        }

        const ins = await env.DB.prepare(`
          INSERT INTO caixa_lancamentos (empresa_id, evento_id, tipo, categoria, descricao, valor, data_movimento, metodo, ativo, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?, ?, 1, datetime('now'), datetime('now'))
        `).bind(
          auth.empresaId,
          eventoId,
          tipo,
          categoria,
          b.descricao || null,
          valor,
          dataMov,
          b.metodo || null
        ).run();

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'caixa_lancamentos', entidadeId: ins.meta.last_row_id });
        // Return updated summary in the same request to guarantee UI reflects the write.
        const resumo = await getCaixaResumo(env, auth.empresaId, { limit: 20 });
        const item = await env.DB.prepare('SELECT * FROM caixa_lancamentos WHERE id=? AND empresa_id=? AND ativo=1')
          .bind(ins.meta.last_row_id, auth.empresaId)
          .first();
        return ok({ id: ins.meta.last_row_id, item, ...resumo });
      }

      // PUT /api/financeiro/caixa/:id
      if (request.method === 'PUT' && id) {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
        const b = parsed.body || {};

        // Only allow safe edits (descricao/metodo/data_movimento/categoria). Valor and tipo are immutable for audit integrity.
        const categoria = b.categoria !== undefined ? String(b.categoria || 'outros') : null;
        const descricao = b.descricao !== undefined ? (b.descricao || null) : null;
        const metodo = b.metodo !== undefined ? (b.metodo || null) : null;
        const dataMov = b.data_movimento !== undefined ? (toIsoDate(b.data_movimento) || null) : null;

        await env.DB.prepare(`
          UPDATE caixa_lancamentos
             SET categoria=COALESCE(?, categoria),
                 descricao=COALESCE(?, descricao),
                 metodo=COALESCE(?, metodo),
                 data_movimento=COALESCE(?, data_movimento),
                 atualizado_em=datetime('now')
           WHERE id=? AND empresa_id=? AND ativo=1
        `).bind(categoria, descricao, metodo, dataMov, asInt(id, 0), auth.empresaId).run();

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'update', entidade: 'caixa_lancamentos', entidadeId: id });
        return ok();
      }

      // DELETE /api/financeiro/caixa/:id
      if (request.method === 'DELETE' && id) {
        await env.DB.prepare(
          "UPDATE caixa_lancamentos SET ativo=0, atualizado_em=datetime('now') WHERE id=? AND empresa_id=? AND ativo=1"
        ).bind(asInt(id, 0), auth.empresaId).run();

        await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'delete', entidade: 'caixa_lancamentos', entidadeId: id });
        const resumo = await getCaixaResumo(env, auth.empresaId, { limit: 20 });
        return ok(resumo);
      }

      return fail(404, 'NOT_FOUND', 'Rota não encontrada');
    }

// POST /api/financeiro
    if (request.method === 'POST' && parts.length === 2) {
      const parsed = await safeJsonBody(request);
      if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
      const b = parsed.body || {};
      if (!b.tipo || b.valor === undefined) return fail(422, 'VALIDATION_ERROR', 'Campos obrigatórios: tipo, valor');

      if (b.evento_id) {
        const ev = await env.DB.prepare('SELECT id FROM eventos WHERE id=? AND empresa_id=? AND ativo=1').bind(b.evento_id, auth.empresaId).first();
        if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');
      }

      const today = toIsoDate(new Date());
      const dataMov = toIsoDate(b.data_movimento) || today;
      const tipo = String(b.tipo || '').toLowerCase();
      if (!['entrada','saida'].includes(tipo)) return fail(422, 'VALIDATION_ERROR', 'tipo inválido');

      const ins = await env.DB.prepare(`
        INSERT INTO caixa_lancamentos (empresa_id, evento_id, tipo, categoria, descricao, valor, data_movimento, metodo, ativo, criado_em, atualizado_em)
        VALUES (?,?,?,?,?,?,?, ?, 1, datetime('now'), datetime('now'))
      `).bind(
        auth.empresaId,
        b.evento_id ? asInt(b.evento_id, 0) : null,
        tipo,
        b.categoria || b.origem || 'outros',
        b.descricao || null,
        fromCents(toCents(b.valor || 0) ?? 0),
        dataMov,
        b.metodo || null
      ).run();

      await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'create', entidade: 'caixa_lancamentos', entidadeId: ins.meta.last_row_id });
      return ok({ id: ins.meta.last_row_id });
    }

    // DELETE /api/financeiro/:id
    if (request.method === 'DELETE' && parts.length === 3) {
      const id = parts[2];
      await env.DB.prepare('UPDATE financeiro SET ativo=0, atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=? AND ativo=1').bind(asInt(id, 0), auth.empresaId).run();
      await logAudit(env, request, auth, { modulo: 'financeiro', acao: 'delete', entidade: 'financeiro', entidadeId: id });
      return ok();
    }

    return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  } catch (err) {
    return fail(500, 'INTERNAL_ERROR', 'Erro interno', String(err?.message || err));
  }
}
