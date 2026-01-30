import { ok, fail, getAuth, requireTenant, safeJsonBody, asInt } from '../utils/api.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';

// Team / Cargos API
// Endpoints:
//  - GET  /api/equipe/cargos
//  - POST /api/equipe/cargos
//
// Notes:
//  - Must be tenant-scoped (empresa_id from session headers injected by requireAuth).
//  - Must NEVER allow null/0 empresa_id.
//  - Minimal, surgical implementation (no refactors of other modules).

function pickStr(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.trim();
}

function pickNullableStr(v) {
  const s = pickStr(v);
  return s ? s : null;
}

function asReal(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeCalcTipo(v) {
  const s = pickStr(v).toUpperCase();
  if (!s) return 'FIXED';
  if (s === 'FIXED' || s === 'PER_GUEST' || s === 'PER_CHILD') return s;
  return 'FIXED';
}

function normalizeRound(v) {
  const s = pickStr(v).toUpperCase();
  if (s === 'CEIL' || s === 'FLOOR') return s;
  return 'CEIL';
}


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
    qty = roundQty(min, roundMode);
  }
  if (!isFinite(qty) || qty < 0) qty = 0;
  if (qty < min) qty = min;
  return qty;
}

async function bulkRecomputeEquipeForEmpresa(env, empresaId) {
  // Recompute auto rows for active/future events after cargo rules change.
  const { results: eventos } = await env.DB.prepare(
    `SELECT id, convidados
     FROM eventos
     WHERE empresa_id=? AND ativo=1
       AND (data_evento IS NULL OR date(data_evento) >= date('now','-1 day'))
     ORDER BY id DESC
     LIMIT 200`
  ).bind(empresaId).all();

  if (!eventos || !eventos.length) return { ok: true, eventos: 0, rows: 0 };

  const { results: cargos } = await env.DB.prepare(
    `SELECT id, calc_tipo, calc_divisor, calc_min, calc_round, custo_padrao
     FROM equipe_cargos
     WHERE empresa_id=? AND ativo=1
     ORDER BY ordem ASC, id ASC`
  ).bind(empresaId).all();

  let rows = 0;
  for (const ev of eventos) {
    const eventoId = ev.id;
    const contexto = { convidados: Number(ev.convidados || 0), criancas: 0 };

    await env.DB.prepare(
      'DELETE FROM evento_equipe WHERE evento_id=? AND empresa_id=? AND auto_calculado=1'
    ).bind(eventoId, empresaId).run();

    for (const c of (cargos || [])) {
      const quantidade = computeCargoQty(c, contexto);
      const custo_unitario = Number(c.custo_padrao || 0);
      const custo_total = Number((quantidade * custo_unitario).toFixed(2));
      if (!quantidade || quantidade <= 0) continue;

      await env.DB.prepare(
        `INSERT INTO evento_equipe
         (evento_id, cargo_id, quantidade, custo_unitario, custo_total, auto_calculado, observacao, atualizado_em, criado_em, empresa_id)
         VALUES (?,?,?,?,?, 1, NULL, datetime('now'), datetime('now'), ?)`
      ).bind(eventoId, c.id, quantidade, custo_unitario, custo_total, empresaId).run();
      rows++;
    }
  }
  return { ok: true, eventos: eventos.length, rows };
}

export async function equipeAPI(request, env) {
  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  // RBAC v2 (module permissions)
  const permErr = await requirePermission(env, auth, 'equipe', actionFromHttp(request.method) || 'read');
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","equipe","cargos", ...]
  const resource = parts[2] || '';
  const empresaId = auth.empresaId;

  try {
    if (resource === 'cargos') {
      if (request.method === 'GET') {
        const onlyActive = url.searchParams.get('ativo');
        const ativoFilter = (onlyActive === null || onlyActive === '') ? null : asInt(onlyActive, null);

        let sql = `
          SELECT id, codigo, nome, descricao, ordem,
                 calc_tipo, calc_divisor, calc_min, calc_round,
                 custo_padrao, ativo, criado_em
          FROM equipe_cargos
          WHERE empresa_id = ?
        `;
        const args = [empresaId];

        if (ativoFilter !== null) {
          sql += ` AND ativo = ?`;
          args.push(ativoFilter);
        }

        sql += ` ORDER BY ordem ASC, nome ASC, id ASC`;

        const { results } = await env.DB.prepare(sql).bind(...args).all();
        return ok({ items: results || [] });
      }

      if (request.method === 'POST') {
        const parsed = await safeJsonBody(request);
        if (!parsed.ok) return fail(400, 'INVALID_JSON', 'Invalid JSON body.');

        const b = parsed.body || {};
        const codigo = pickStr(b.codigo);
        const nome = pickStr(b.nome);

        if (!codigo) return fail(400, 'VALIDATION', 'codigo is required.');
        if (!nome) return fail(400, 'VALIDATION', 'nome is required.');

        const descricao = pickNullableStr(b.descricao);
        const ordem = asInt(b.ordem, 0);
        const calc_tipo = normalizeCalcTipo(b.calc_tipo);
        const calc_divisor = asInt(b.calc_divisor, null);
        const calc_min = asInt(b.calc_min, 0);
        const calc_round = normalizeRound(b.calc_round);
        const custo_padrao = asReal(b.custo_padrao, 0);
        const ativo = (b.ativo === undefined || b.ativo === null) ? 1 : asInt(b.ativo, 1);

        // Enforce tenant injection (never trust client-provided empresa_id)
        const now = new Date().toISOString();

        const sql = `
          INSERT INTO equipe_cargos (
            codigo, nome, descricao, ordem,
            calc_tipo, calc_divisor, calc_min, calc_round,
            custo_padrao, ativo, criado_em, empresa_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const stmt = env.DB.prepare(sql).bind(
          codigo, nome, descricao, ordem,
          calc_tipo, calc_divisor, calc_min, calc_round,
          custo_padrao, ativo, now, empresaId
        );

        const res = await stmt.run();

        // Auto-recompute team for active/future events so derived data stays consistent
        const rec = await bulkRecomputeEquipeForEmpresa(env, empresaId);

        return ok({
          id: res?.meta?.last_row_id ?? null,
          message: 'Cargo criado com sucesso.',
          recompute: rec,
        }, 201);
      }


// UPDATE cargo (enable/disable, change calc rules, etc.)
// PATCH /api/equipe/cargos/:id
if ((request.method === 'PATCH' || request.method === 'PUT') && parts[3]) {
  const cargoId = asInt(parts[3], null);
  if (!cargoId) return fail(400, 'VALIDATION', 'Invalid cargo id.');

  const parsed = await safeJsonBody(request);
  if (!parsed.ok) return fail(400, 'INVALID_JSON', 'Invalid JSON body.');
  const b = parsed.body || {};

  const exists = await env.DB.prepare('SELECT id FROM equipe_cargos WHERE id=? AND empresa_id=?')
    .bind(cargoId, empresaId).first();
  if (!exists) return fail(404, 'NOT_FOUND', 'Cargo não encontrado');

  const allow = ['codigo','nome','descricao','ordem','calc_tipo','calc_divisor','calc_min','calc_round','custo_padrao','ativo'];
  const fields = [];
  const binds = [];

  for (const k of allow) {
    if (b[k] !== undefined) {
      if (k === 'calc_tipo') { fields.push('calc_tipo=?'); binds.push(normalizeCalcTipo(b.calc_tipo)); continue; }
      if (k === 'calc_round') { fields.push('calc_round=?'); binds.push(normalizeRound(b.calc_round)); continue; }
      if (k === 'descricao') { fields.push('descricao=?'); binds.push(pickNullableStr(b.descricao)); continue; }
      if (k === 'codigo') { fields.push('codigo=?'); binds.push(pickStr(b.codigo)); continue; }
      if (k === 'nome') { fields.push('nome=?'); binds.push(pickStr(b.nome)); continue; }
      if (k === 'ordem') { fields.push('ordem=?'); binds.push(asInt(b.ordem, 0)); continue; }
      if (k === 'calc_divisor') { fields.push('calc_divisor=?'); binds.push(asInt(b.calc_divisor, null)); continue; }
      if (k === 'calc_min') { fields.push('calc_min=?'); binds.push(asInt(b.calc_min, 0)); continue; }
      if (k === 'custo_padrao') { fields.push('custo_padrao=?'); binds.push(asReal(b.custo_padrao, 0)); continue; }
      if (k === 'ativo') { fields.push('ativo=?'); binds.push(asInt(b.ativo, 1)); continue; }
    }
  }

  if (!fields.length) return fail(422, 'VALIDATION', 'Nada para atualizar.');

  binds.push(cargoId);
  await env.DB.prepare(`UPDATE equipe_cargos SET ${fields.join(', ')} WHERE id=? AND empresa_id=?`)
    .bind(...binds, empresaId).run();

  // Auto-recompute team for active/future events so derived data stays consistent
  const rec = await bulkRecomputeEquipeForEmpresa(env, empresaId);

  return ok({ ok: true, recompute: rec });
}

      return fail(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }

    return fail(404, 'NOT_FOUND', 'Route not found.');
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : String(err);
    // Handle common SQLite constraint patterns without leaking SQL.
    if (msg.includes('UNIQUE') || msg.toLowerCase().includes('unique constraint')) {
      return fail(409, 'CONFLICT', 'Cargo with same codigo already exists.');
    }
    return fail(500, 'INTERNAL', 'Internal Server Error', { message: msg });
  }
}
