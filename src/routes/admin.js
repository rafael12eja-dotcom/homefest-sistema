// src/routes/admin.js
// Admin-only diagnostic and maintenance utilities.
// Must not introduce tenant fallbacks. Any data fix is explicit, gated, and safe.

import { ok, fail, getAuth, requireAdmin } from '../utils/api.js';

function requireSuperAdmin(env, auth) {
  // Super-admin is explicitly the admin user under ADMIN_EMPRESA_ID.
  const adminEmpresaId = Number(env.ADMIN_EMPRESA_ID);
  if (!Number.isFinite(adminEmpresaId) || adminEmpresaId <= 0) {
    return fail(500, 'MISCONFIG', 'ADMIN_EMPRESA_ID is not configured.');
  }
  if (auth.empresaId !== adminEmpresaId) {
    return fail(403, 'FORBIDDEN', 'Super-admin required.');
  }
  return null;
}

async function countNullEmpresa(env, table) {
  const res = await env.DB.prepare(`SELECT COUNT(1) AS n FROM ${table} WHERE empresa_id IS NULL`).all();
  const n = res?.results?.[0]?.n ?? 0;
  return Number(n) || 0;
}

async function getDistinctEmpresaId(env, table) {
  // Returns { distinct: number, only: number|null }
  const res = await env.DB.prepare(
    `SELECT COUNT(DISTINCT empresa_id) AS d, MIN(empresa_id) AS min_id, MAX(empresa_id) AS max_id
     FROM ${table}
     WHERE empresa_id IS NOT NULL`
  ).all();
  const row = res?.results?.[0] || {};
  const d = Number(row.d) || 0;
  const minId = row.min_id == null ? null : Number(row.min_id);
  const maxId = row.max_id == null ? null : Number(row.max_id);
  const only = d === 1 && minId != null && maxId != null && minId === maxId ? minId : null;
  return { distinct: d, only };
}

async function backfillNullEmpresaSafe(env, table, targetEmpresaId) {
  const nulls = await countNullEmpresa(env, table);
  if (nulls <= 0) return { table, updated: 0, skipped: false, reason: 'no_nulls' };

  const distinct = await getDistinctEmpresaId(env, table);
  // Safe condition:
  // - either there is no non-null empresa_id yet, OR
  // - there is exactly 1 non-null empresa_id and it matches target.
  if (!(distinct.distinct === 0 || (distinct.distinct === 1 && distinct.only === targetEmpresaId))) {
    return {
      table,
      updated: 0,
      skipped: true,
      reason: 'multiple_tenants_detected',
      details: distinct,
      nulls,
    };
  }

  const stmt = env.DB.prepare(`UPDATE ${table} SET empresa_id = ? WHERE empresa_id IS NULL`).bind(targetEmpresaId);
  const res = await stmt.run();
  const updated = Number(res?.meta?.changes) || 0;
  return { table, updated, skipped: false, reason: 'backfilled', nulls_before: nulls };
}

export async function adminRouter(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();
    const auth = getAuth(request);

    const errAdmin = requireAdmin(auth);
    if (errAdmin) return errAdmin;
    const errSuper = requireSuperAdmin(env, auth);
    if (errSuper) return errSuper;

    const targetEmpresaId = Number(env.ADMIN_EMPRESA_ID);

    if (method === 'GET' && path === '/api/admin/diag-null-empresa') {
      const tables = [
        'leads',
        'clientes',
        'eventos',
        'evento_itens',
        'financeiro',
        'ar_titulos',
        'ar_parcelas',
        'ap_contas',
        'caixa_lancamentos',
      ];
      const out = {};
      for (const t of tables) {
        // table may not exist on older schemas; handle safely
        try {
          out[t] = {
            nulls: await countNullEmpresa(env, t),
            ...(await getDistinctEmpresaId(env, t)),
          };
        } catch {
          out[t] = { nulls: 0, distinct: 0, only: null, note: 'table_missing' };
        }
      }
      return ok({ diagnostics: out, targetEmpresaId });
    }

    if (method === 'POST' && path === '/api/admin/backfill-null-empresa') {
      // Explicit maintenance action: backfill NULL empresa_id only when safe.
      const tables = [
        'leads',
        'clientes',
        'eventos',
        'evento_itens',
        'financeiro',
        'ar_titulos',
        'ar_parcelas',
        'ap_contas',
        'caixa_lancamentos',
      ];
      const results = [];
      for (const t of tables) {
        try {
          results.push(await backfillNullEmpresaSafe(env, t, targetEmpresaId));
        } catch (e) {
          results.push({ table: t, updated: 0, skipped: true, reason: 'error', message: String(e?.message || e) });
        }
      }
      return ok({ results, targetEmpresaId });
    }

    return fail(404, 'NOT_FOUND', 'Route not found.');
  } catch (e) {
    return fail(500, 'INTERNAL', 'Admin router error.', { message: String(e?.message || e) });
  }
}
