// src/utils/rbac.js
// Module-level authorization (RBAC v2).
// Design goals:
// - Fail-closed (no implicit permissions).
// - 'admin' remains full access (backward compatible).
// - Tenant-safe: all checks are scoped by empresa_id.
// - Production-safe: never throw (callers handle via returned Response).

import { fail } from './api.js';

export const RBAC_MODULES = [
  'dashboard',
  'leads',
  'clientes',
  'eventos',
  'financeiro',
  'usuarios',
  'propostas',
  'contratos',
  'equipe',
];

export const RBAC_ACTIONS = ['read', 'create', 'update', 'delete'];

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

export function actionFromHttp(method) {
  switch ((method || '').toUpperCase()) {
    case 'GET': return 'read';
    case 'POST': return 'create';
    case 'PUT': return 'update';
    case 'PATCH': return 'update';
    case 'DELETE': return 'delete';
    default: return null;
  }
}

/**
 * requirePermission(env, auth, modulo, acao) -> Response|null
 * Returns a 403 JSON Response if forbidden, otherwise null.
 */
export async function requirePermission(env, auth, modulo, acao) {
  try {
    const perfil = norm(auth?.perfil);
    const empresaId = auth?.empresaId;

    // Auth middleware should have enforced authentication already.
    if (!perfil) return fail(401, 'UNAUTHENTICATED', 'Not authenticated.');

    // Admin remains a superuser within the tenant.
    if (perfil === 'admin') return null;

    const m = norm(modulo);
    const a = norm(acao);

    if (!RBAC_MODULES.includes(m) || !RBAC_ACTIONS.includes(a)) {
      // Misconfiguration is a server error, not a forbidden.
      return fail(500, 'RBAC_CONFIG', `Invalid RBAC mapping: ${m}:${a}`);
    }
    if (!Number.isFinite(empresaId) || empresaId <= 0) {
      return fail(400, 'INVALID_SESSION', 'Missing or invalid empresa_id in session token.');
    }
    if (!env?.DB) return fail(500, 'DB_NOT_CONFIGURED', 'DB not configured.');

    const row = await env.DB
      .prepare(
        `SELECT permitido
           FROM perfis_permissoes
          WHERE empresa_id = ?
            AND perfil = ?
            AND modulo = ?
            AND acao = ?
            AND ativo = 1
          LIMIT 1`
      )
      .bind(empresaId, perfil, m, a)
      .first();

    const allowed = row && Number(row.permitido) === 1;
    if (!allowed) return fail(403, 'FORBIDDEN', 'Sem permissão.');
    return null;
  } catch (e) {
    // Never throw to avoid Worker 1101.
    return fail(500, 'RBAC_ERROR', 'RBAC check failed.', { message: String(e?.message || e) });
  }
}
