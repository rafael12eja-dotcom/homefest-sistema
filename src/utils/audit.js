// src/utils/audit.js
// Minimal tenant-scoped audit logging (Phase 1.2 prerequisite).
// IMPORTANT: Never log sensitive data (no request bodies, no secrets).

import { requireTenant } from './api.js';

function pickStr(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.trim();
}

export async function logAudit(env, request, auth, entry) {
  // Best-effort, never throw (auditing must not break production flows).
  try {
    const tenantErr = requireTenant(auth);
    if (tenantErr) return;

    const url = new URL(request.url);

    const modulo = pickStr(entry?.modulo);
    const acao = pickStr(entry?.acao);
    if (!modulo || !acao) return;

    const rota = pickStr(entry?.rota) || url.pathname;
    const metodo = pickStr(entry?.metodo) || request.method;

    const entidade = entry?.entidade ? pickStr(entry.entidade) : null;
    const entidadeId = (entry?.entidadeId === undefined || entry?.entidadeId === null)
      ? null
      : Number.isFinite(Number(entry.entidadeId)) ? Math.trunc(Number(entry.entidadeId)) : null;

    const ip = pickStr(request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '') || null;
    const userAgent = pickStr(request.headers.get('user-agent') || '') || null;

    await env.DB.prepare(`
      INSERT INTO audit_logs (
        empresa_id, user_id, user_email, perfil,
        acao, modulo, rota, metodo,
        entidade, entidade_id, ip, user_agent,
        criado_em
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
    `).bind(
      auth.empresaId,
      auth.userId || 0,
      auth.userEmail || null,
      auth.perfil || null,
      acao,
      modulo,
      rota,
      metodo,
      entidade,
      entidadeId,
      ip,
      userAgent,
    ).run();
  } catch (e) {
    // Never surface to client; log for diagnostics.
    console.error('AUDIT_LOG_ERROR', e);
  }
}
