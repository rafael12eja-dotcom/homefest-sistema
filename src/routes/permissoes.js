// src/routes/permissoes.js
// RBAC UX endpoints:
// - GET /api/permissoes/me: returns permissions map for current user (tenant-scoped)
// - Admin endpoints to manage perfil permissions (tenant-scoped)

import { ok, fail, getAuth, requireTenant, requireAdmin, safeJsonBody } from '../utils/api.js';
import { RBAC_MODULES, RBAC_ACTIONS } from '../utils/rbac.js';
import { logAudit } from '../utils/audit.js';

function norm(s) { return String(s || '').trim().toLowerCase(); }

function buildEmptyMap() {
  const map = {};
  for (const m of RBAC_MODULES) map[m] = [];
  return map;
}

async function loadAllowed(env, empresaId, perfil) {
  const rows = await env.DB
    .prepare(`SELECT modulo, acao FROM perfis_permissoes
              WHERE empresa_id = ? AND perfil = ? AND ativo = 1 AND permitido = 1`)
    .bind(empresaId, perfil)
    .all();
  return rows.results || [];
}

export async function permissoesAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const auth = getAuth(request);

  // Defensive: tenant required for all endpoints.
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  if (!env?.DB) return fail(500, 'DB_NOT_CONFIGURED', 'DB not configured.');

  // GET /api/permissoes/me
  if (path === '/api/permissoes/me' && request.method === 'GET') {
    try {
      const perfil = norm(auth.perfil);
      if (!perfil) return fail(401, 'UNAUTHENTICATED', 'Not authenticated.');

      // Admin: return full access (backward compatible).
      const perms = buildEmptyMap();
      if (perfil === 'admin') {
        for (const m of RBAC_MODULES) perms[m] = [...RBAC_ACTIONS];
        return ok({ perfil, empresa_id: auth.empresaId, permissoes: perms });
      }

      const allowed = await loadAllowed(env, auth.empresaId, perfil);
      for (const r of allowed) {
        const m = norm(r.modulo);
        const a = norm(r.acao);
        if (!perms[m]) perms[m] = [];
        if (!perms[m].includes(a)) perms[m].push(a);
      }
      // Keep stable ordering
      for (const m of Object.keys(perms)) perms[m].sort((x,y)=>RBAC_ACTIONS.indexOf(x)-RBAC_ACTIONS.indexOf(y));
      return ok({ perfil, empresa_id: auth.empresaId, permissoes: perms });
    } catch (e) {
      return fail(500, 'INTERNAL_ERROR', 'Erro interno.', { message: String(e?.message || e) });
    }
  }

  // Admin endpoints
  const adminErr = requireAdmin(auth);
  if (adminErr) return adminErr;

  // GET /api/permissoes/perfis?perfil=vendas
  if (path === '/api/permissoes/perfis' && request.method === 'GET') {
    try {
      const perfil = norm(url.searchParams.get('perfil') || '');
      if (!perfil) return fail(400, 'INVALID_REQUEST', 'Informe o perfil.');

      const perms = {};
      for (const m of RBAC_MODULES) {
        perms[m] = {};
        for (const a of RBAC_ACTIONS) perms[m][a] = 0;
      }

      const rows = await env.DB
        .prepare(`SELECT modulo, acao, permitido
                  FROM perfis_permissoes
                  WHERE empresa_id = ? AND perfil = ? AND ativo = 1`)
        .bind(auth.empresaId, perfil)
        .all();
      for (const r of (rows.results || [])) {
        const m = norm(r.modulo); const a = norm(r.acao);
        if (perms[m] && perms[m][a] !== undefined) perms[m][a] = Number(r.permitido) === 1 ? 1 : 0;
      }
      return ok({ perfil, empresa_id: auth.empresaId, permissoes: perms, modulos: RBAC_MODULES, acoes: RBAC_ACTIONS });
    } catch (e) {
      return fail(500, 'INTERNAL_ERROR', 'Erro interno.', { message: String(e?.message || e) });
    }
  }

  // PUT /api/permissoes/perfis  { perfil, permissoes: { modulo: { acao: 0/1 } } }
  if (path === '/api/permissoes/perfis' && request.method === 'PUT') {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'INVALID_JSON', 'JSON inválido.');

    const perfil = norm(parsed.body?.perfil || '');
    const permissoes = parsed.body?.permissoes;
    if (!perfil || !permissoes || typeof permissoes !== 'object') {
      return fail(400, 'INVALID_REQUEST', 'Payload inválido.');
    }
    // Never allow changing admin permissions via UI (admin is superuser anyway)
    if (perfil === 'admin') return fail(400, 'INVALID_REQUEST', 'Permissões de admin são fixas.');

    try {
      const stmts = [];
      for (const m of RBAC_MODULES) {
        const modObj = permissoes[m] || {};
        for (const a of RBAC_ACTIONS) {
          const val = modObj[a] ? 1 : 0;
          stmts.push(env.DB.prepare(
            `INSERT INTO perfis_permissoes (empresa_id, perfil, modulo, acao, permitido, ativo, criado_em, atualizado_em)
             VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
             ON CONFLICT(empresa_id, perfil, modulo, acao)
             DO UPDATE SET permitido = excluded.permitido, ativo = 1, atualizado_em = datetime('now')`
          ).bind(auth.empresaId, perfil, m, a, val));
        }
      }
      await env.DB.batch(stmts);
      await logAudit(env, request, auth, { modulo: 'permissoes', acao: 'update', entidade: 'perfis_permissoes', entidadeId: null });
      return ok({ message: 'Permissões atualizadas.' });
    } catch (e) {
      return fail(500, 'INTERNAL_ERROR', 'Erro interno.', { message: String(e?.message || e) });
    }
  }

  return fail(404, 'NOT_FOUND', 'Rota não encontrada.');
}
