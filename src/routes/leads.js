// src/routes/leads.js
// Leads CRM: pipeline + conversion to client/event + notes/history
// Tenant-safe: all operations are scoped by empresa_id from the session token.

import { json, ok, fail, getAuth, requireTenant, safeJsonBody } from '../utils/api.js';
import { logAudit } from '../utils/audit.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';

function pad(num, size) {
  let s = String(num);
  while (s.length < size) s = '0' + s;
  return s;
}

function normalizeMoneyNumber(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  // Avoid float drift by rounding to 2 decimals at the boundary.
  return Math.round(n * 100) / 100;
}

function safeStatus(s) {
  const allowed = new Set([
    'novo',
    'em_atendimento',
    'orcamento_enviado',
    'follow_up',
    'fechado',
    'perdido',
  ]);
  return allowed.has(s) ? s : 'novo';
}

export async function leadsAPI(request, env) {
  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  // RBAC v2 (module permissions)
  // Notes/conversion endpoints are treated as UPDATE for leads.
  const urlTmp = new URL(request.url);
  const partsTmp = urlTmp.pathname.split('/').filter(Boolean);
  const subTmp = partsTmp[3];
  const actionTmp = (subTmp === 'notes' || subTmp === 'converter') ? 'update' : (actionFromHttp(request.method) || 'read');
  const permErr = await requirePermission(env, auth, 'leads', actionTmp);
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","leads",":id?","sub?"]
  const id = parts[2]; // may be undefined
  const sub = parts[3]; // may be "converter" | "notes"

  const userEmail = auth.userEmail || null;

  try {
  // GET /api/leads?status=&q=
  if (request.method === 'GET' && !id) {
    const status = url.searchParams.get('status');
    const q = (url.searchParams.get('q') || '').trim();

    const where = ['empresa_id = ?', 'ativo = 1'];
    const binds = [auth.empresaId];

    if (status) {
      where.push('status = ?');
      binds.push(safeStatus(status));
    }
    if (q) {
      where.push('(nome LIKE ? OR telefone LIKE ? OR email LIKE ? OR origem LIKE ? OR cidade LIKE ? OR bairro LIKE ?)');
      const like = `%${q}%`;
      binds.push(like, like, like, like, like, like);
    }

    const sql = `SELECT * FROM leads WHERE ${where.join(' AND ')} ORDER BY id DESC`;
    const { results } = await env.DB.prepare(sql).bind(...binds).all();
    return json(results);
  }

  // GET /api/leads/:id
  if (request.method === 'GET' && id && !sub) {
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!lead) return fail(404, 'NOT_FOUND', 'Lead não encontrado');
    return json(lead);
  }

  // POST /api/leads
  if (request.method === 'POST' && !id) {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const b = parsed.body;
    const nome = String(b.nome || '').trim();
    if (!nome) return fail(422, 'VALIDATION_ERROR', 'Nome é obrigatório');

    await env.DB.prepare(`
      INSERT INTO leads (empresa_id, nome,telefone,email,cidade,bairro,origem,status,observacoes, ativo, criado_em, atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
    `).bind(
      auth.empresaId,
      nome,
      (b.telefone || null),
      (b.email || null),
      (b.cidade || null),
      (b.bairro || null),
      (b.origem || null),
      safeStatus(b.status || 'novo'),
      (b.observacoes || null)
    ).run();

    await logAudit(env, request, auth, { modulo: 'leads', acao: 'create', entidade: 'leads' });
    return ok();
  }

  // PUT /api/leads/:id
  if (request.method === 'PUT' && id && !sub) {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const b = parsed.body;
    const lead = await env.DB.prepare('SELECT * FROM leads WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!lead) return fail(404, 'NOT_FOUND', 'Lead não encontrado');

    const nome = (b.nome !== undefined) ? String(b.nome || '').trim() : lead.nome;
    if (!nome) return fail(422, 'VALIDATION_ERROR', 'Nome é obrigatório');

    await env.DB.prepare(`
      UPDATE leads
      SET nome=?, telefone=?, email=?, cidade=?, bairro=?, origem=?, status=?, observacoes=?, atualizado_em=datetime('now')
      WHERE id=? AND empresa_id=? AND ativo=1
    `).bind(
      nome,
      (b.telefone !== undefined ? (b.telefone || null) : lead.telefone),
      (b.email !== undefined ? (b.email || null) : lead.email),
      (b.cidade !== undefined ? (b.cidade || null) : lead.cidade),
      (b.bairro !== undefined ? (b.bairro || null) : lead.bairro),
      (b.origem !== undefined ? (b.origem || null) : lead.origem),
      (b.status !== undefined ? safeStatus(b.status) : safeStatus(lead.status)),
      (b.observacoes !== undefined ? (b.observacoes || null) : lead.observacoes),
      id,
      auth.empresaId
    ).run();

    await logAudit(env, request, auth, { modulo: 'leads', acao: 'update', entidade: 'leads' });
    return ok();
  }

  // DELETE /api/leads/:id
  if (request.method === 'DELETE' && id && !sub) {
    // Soft delete to preserve history.
    await env.DB.prepare('UPDATE leads SET ativo=0, atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=?').bind(id, auth.empresaId).run();
    return ok();
  }

  // NOTES
  // GET /api/leads/:id/notes
  if (request.method === 'GET' && id && sub === 'notes') {
    // Ensure lead belongs to tenant.
    const lead = await env.DB.prepare('SELECT id FROM leads WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!lead) return fail(404, 'NOT_FOUND', 'Lead não encontrado');
    const { results } = await env.DB.prepare(
      'SELECT id, lead_id, note, created_by, created_at FROM lead_notes WHERE lead_id=? ORDER BY id DESC'
    ).bind(id).all();
    return json(results);
  }

  // POST /api/leads/:id/notes
  if (request.method === 'POST' && id && sub === 'notes') {
    const lead = await env.DB.prepare('SELECT id FROM leads WHERE id=? AND empresa_id=? AND ativo=1').bind(id, auth.empresaId).first();
    if (!lead) return fail(404, 'NOT_FOUND', 'Lead não encontrado');
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const b = parsed.body;
    const note = String(b.note || '').trim();
    if (!note) return fail(422, 'VALIDATION_ERROR', 'Nota vazia');

    await env.DB.prepare(
      'INSERT INTO lead_notes (lead_id, note, created_by) VALUES (?,?,?)'
    ).bind(id, note, userEmail).run();

    return ok();
  }

  // POST /api/leads/:id/converter
  if (request.method === 'POST' && id && sub === 'converter') {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
    const b = parsed.body;

    // RBAC: converting a lead creates a client and an event.
    const permCli = await requirePermission(env, auth, 'clientes', 'create');
    if (permCli) return permCli;
    const permEvt = await requirePermission(env, auth, 'eventos', 'create');
    if (permEvt) return permEvt;

    // 0) fetch lead BEFORE opening a transaction (so we can fail cleanly).
    const leadRow = await env.DB
      .prepare('SELECT * FROM leads WHERE id=? AND empresa_id=? AND ativo=1')
      .bind(id, auth.empresaId)
      .first();
    if (!leadRow) return fail(404, 'NOT_FOUND', 'Lead não encontrado');

    // 1) transactional conversion: close lead + create/reuse client + create event + optional initial caixa entry.
    await env.DB.exec('BEGIN');
    try {
      // 1.1) mark lead as closed
      await env.DB
        .prepare("UPDATE leads SET status='fechado', atualizado_em=datetime('now') WHERE id=? AND empresa_id=?")
        .bind(id, auth.empresaId)
        .run();

      // 1.2) history
      await env.DB
        .prepare('INSERT INTO lead_notes (lead_id, note, created_by) VALUES (?,?,?)')
        .bind(id, 'Lead convertido em Cliente + Festa', userEmail)
        .run();

      // 1.3) create or reuse client
      let clienteId = null;
      const existente = await env.DB
        .prepare('SELECT id FROM clientes WHERE lead_id=? AND empresa_id=? AND ativo=1')
        .bind(id, auth.empresaId)
        .first();
      if (existente?.id) {
        clienteId = existente.id;
      } else {
        const insCliente = await env.DB
          .prepare(`
            INSERT INTO clientes (empresa_id, lead_id, nome, telefone, email, cidade, bairro, ativo, criado_em, atualizado_em)
            VALUES (?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
          `)
          .bind(
            auth.empresaId,
            id,
            leadRow.nome || null,
            leadRow.telefone || null,
            leadRow.email || null,
            leadRow.cidade || null,
            leadRow.bairro || null
          )
          .run();
        clienteId = insCliente.meta.last_row_id;
      }

      // 1.4) create event
      const statusEvento = (b.status_evento && String(b.status_evento).trim()) ? String(b.status_evento).trim() : 'orcamento';
      const insEvento = await env.DB
        .prepare(`
          INSERT INTO eventos (empresa_id, cliente_id, tipo_evento, data_evento, convidados, valor_total, status, forma_pagamento, ativo, criado_em, atualizado_em)
          VALUES (?,?,?,?,?,?,?, ?, 1, datetime('now'), datetime('now'))
        `)
        .bind(
          auth.empresaId,
          clienteId,
          b.tipo_evento || 'Outro',
          b.data_evento || null,
          Number(b.convidados || 0),
          normalizeMoneyNumber(b.valor_total || 0),
          statusEvento,
          b.forma_pagamento || null
        )
        .run();

      const eventoId = insEvento.meta.last_row_id;

      // 1.5) generate contract number HF-YYYY-00001 (based on eventoId)
      const year = new Date().getFullYear();
      const contrato = `HF-${year}-${pad(eventoId, 5)}`;
      await env.DB
        .prepare('UPDATE eventos SET contrato_numero=?, atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=?')
        .bind(contrato, eventoId, auth.empresaId)
        .run();

      // 1.6) optional initial cash entry (sinal) -> canonical ledger
      const valorSinal = normalizeMoneyNumber(b.valor_sinal || 0);
      if (valorSinal > 0) {
        const today = new Date().toISOString().slice(0, 10);
        await env.DB
          .prepare(`
            INSERT INTO caixa_lancamentos (empresa_id, evento_id, tipo, categoria, descricao, valor, data_movimento, metodo, referencia, ativo, criado_em, atualizado_em)
            VALUES (?,?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
          `)
          .bind(
            auth.empresaId,
            eventoId,
            'entrada',
            'Recebimento',
            `Sinal do contrato ${contrato}`,
            valorSinal,
            today,
            (b.metodo || 'pix'),
            'sinal_contrato'
          )
          .run();
      }

      await env.DB.exec('COMMIT');
      return ok({ cliente_id: clienteId, evento_id: eventoId, contrato_numero: contrato });
    } catch (e) {
      try { await env.DB.exec('ROLLBACK'); } catch (_) {}
      return fail(500, 'SERVER_ERROR', 'Falha ao converter lead.');
    }
  }

  return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  } catch (err) {
    return fail(500, 'INTERNAL_ERROR', 'Erro interno', String(err?.message || err));
  }
}
