// src/utils/api.js
// Shared API helpers for consistent JSON responses and tenant-safe auth context.
// Code/comments in English per project standard.

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function ok(data = {}, status = 200) {
  return json({ ok: true, ...data }, status);
}

export function fail(status, error, message, details = undefined) {
  const payload = { ok: false, error, message };
  if (details !== undefined) payload.details = details;
  return json(payload, status);
}

export function asInt(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

export function getAuth(request) {
  const userEmail = request.headers.get('x-user') || '';
  const userId = asInt(request.headers.get('x-user-id'), 0);
  const perfil = request.headers.get('x-perfil') || '';
  const empresaId = asInt(request.headers.get('x-empresa-id'), null);
  return { userEmail, userId, perfil, empresaId };
}

export function requireTenant(auth) {
  if (!Number.isFinite(auth.empresaId) || auth.empresaId <= 0) {
    return fail(400, 'INVALID_SESSION', 'Missing or invalid empresa_id in session token.');
  }
  return null;
}

export function requireAdmin(auth) {
  if (auth.perfil !== 'admin') {
    return fail(403, 'FORBIDDEN', 'Admin access required.');
  }
  return null;
}

export async function safeJsonBody(request) {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}
