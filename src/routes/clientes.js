import { json, ok, fail, getAuth, requireTenant, safeJsonBody } from '../utils/api.js';
import { logAudit } from '../utils/audit.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';

function pickStr(v) {
  const s = (v === undefined || v === null) ? '' : String(v);
  return s.trim();
}

function pickNullableStr(v) {
  const s = pickStr(v);
  return s ? s : null;
}

function asInt(v, fallback = null) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// Clientes API
// - GET    /api/clientes
// - POST   /api/clientes
// - GET    /api/clientes/:id
// - PUT    /api/clientes/:id
export async function clientesAPI(request, env) {
  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  // RBAC v2 (module permissions)
  const permErr = await requirePermission(env, auth, 'clientes', actionFromHttp(request.method) || 'read');
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","clientes",":id?", ...]
  const id = parts[2];

  try {
  // GET /api/clientes
  if (request.method === 'GET' && !id) {
    // List customers with last event and total events (lightweight)
    const q = `
      SELECT
        c.id,
        c.lead_id,
        c.nome,
        c.telefone,
        c.email,
        c.cidade,
        c.bairro,
        c.cep,
        c.endereco,
        c.numero,
        c.complemento,
        c.estado,
        c.observacoes,
        (SELECT COUNT(1) FROM eventos e WHERE e.cliente_id = c.id AND e.empresa_id = ?) AS total_eventos,
        (SELECT e2.data_evento FROM eventos e2 WHERE e2.cliente_id = c.id AND e2.empresa_id = ? ORDER BY e2.id DESC LIMIT 1) AS ultimo_evento_data,
        (SELECT e3.contrato_numero FROM eventos e3 WHERE e3.cliente_id = c.id AND e3.empresa_id = ? ORDER BY e3.id DESC LIMIT 1) AS ultimo_evento_contrato
      FROM clientes c
      WHERE c.empresa_id = ? AND c.ativo = 1
      ORDER BY c.id DESC
    `;

    const { results } = await env.DB.prepare(q).bind(auth.empresaId, auth.empresaId, auth.empresaId, auth.empresaId).all();
    return json(results);
  }

  // POST /api/clientes
  if (request.method === 'POST' && !id) {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const body = parsed.body;

    const nome = pickStr(body.nome);
    if (!nome) return fail(422, 'VALIDATION_ERROR', 'Nome é obrigatório');

    const leadId = body.lead_id ? asInt(body.lead_id, null) : null;

    const stmt = await env.DB.prepare(`
      INSERT INTO clientes (
        empresa_id, lead_id, nome, telefone, email, cidade, bairro,
        cep, endereco, numero, complemento, estado, observacoes,
        ativo, criado_em, atualizado_em
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
    `).bind(
      auth.empresaId,
      leadId,
      nome,
      pickNullableStr(body.telefone),
      pickNullableStr(body.email),
      pickNullableStr(body.cidade),
      pickNullableStr(body.bairro),
      pickNullableStr(body.cep),
      pickNullableStr(body.endereco),
      pickNullableStr(body.numero),
      pickNullableStr(body.complemento),
      pickNullableStr(body.estado),
      pickNullableStr(body.observacoes)
    ).run();

    const newId = stmt.meta.last_row_id;
    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=?').bind(newId, auth.empresaId).first();
    await logAudit(env, request, auth, { modulo: 'clientes', acao: 'create', entidade: 'clientes', entidadeId: newId });
    return json({ ok: true, id: newId, cliente }, 201);
  }

  // GET /api/clientes/:id
  if (request.method === 'GET' && id) {
    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!cliente) return fail(404, 'NOT_FOUND', 'Cliente não encontrado');

    const { results: eventos } = await env.DB.prepare(`
      SELECT id, tipo_evento, data_evento, convidados, valor_total, status, contrato_numero, forma_pagamento, criado_em
      FROM eventos
      WHERE cliente_id=? AND empresa_id=? AND ativo=1
      ORDER BY id DESC
    `).bind(id, auth.empresaId).all();

    return json({ cliente, eventos });
  }

  // PUT /api/clientes/:id
  if (request.method === 'PUT' && id) {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const body = parsed.body;

    const exists = await env.DB.prepare('SELECT id FROM clientes WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!exists) return fail(404, 'NOT_FOUND', 'Cliente não encontrado');

    const nome = pickStr(body.nome);
    if (!nome) return fail(422, 'VALIDATION_ERROR', 'Nome é obrigatório');

    await env.DB.prepare(`
      UPDATE clientes
      SET
        nome=?,
        telefone=?,
        email=?,
        cidade=?,
        bairro=?,
        cep=?,
        endereco=?,
        numero=?,
        complemento=?,
        estado=?,
        observacoes=?,
        atualizado_em=datetime('now')
      WHERE id=? AND empresa_id=? AND ativo=1
    `).bind(
      nome,
      pickNullableStr(body.telefone),
      pickNullableStr(body.email),
      pickNullableStr(body.cidade),
      pickNullableStr(body.bairro),
      pickNullableStr(body.cep),
      pickNullableStr(body.endereco),
      pickNullableStr(body.numero),
      pickNullableStr(body.complemento),
      pickNullableStr(body.estado),
      pickNullableStr(body.observacoes),
      id,
      auth.empresaId
    ).run();

    const cliente = await env.DB.prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=?').bind(id, auth.empresaId).first();
    await logAudit(env, request, auth, { modulo: 'clientes', acao: 'update', entidade: 'clientes', entidadeId: id });
    return ok({ cliente });
  }



  // DELETE /api/clientes/:id
  if (request.method === 'DELETE' && id) {
    // Soft delete (archive) to preserve history.
    const exists = await env.DB.prepare('SELECT id FROM clientes WHERE id=? AND empresa_id=? AND ativo=1')
      .bind(id, auth.empresaId).first();
    if (!exists) return fail(404, 'NOT_FOUND', 'Cliente não encontrado');

    await env.DB.prepare("UPDATE clientes SET ativo=0, atualizado_em=datetime('now') WHERE id=? AND empresa_id=?")
      .bind(id, auth.empresaId).run();

    await logAudit(env, request, auth, { modulo: 'clientes', acao: 'delete', entidade: 'clientes', entidadeId: id });
    return ok();
  }

  return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  } catch (err) {
    return fail(500, 'INTERNAL_ERROR', 'Erro interno', String(err?.message || err));
  }
}
