import { json, ok, fail, getAuth, requireTenant, safeJsonBody } from '../utils/api.js';
import { requirePermission, actionFromHttp } from '../utils/rbac.js';
import { logAudit } from '../utils/audit.js';

async function hasColumn(env, table, column) {
  // D1/SQLite: PRAGMA table_info returns rows: cid,name,type,notnull,dflt_value,pk
  // Used to support older DBs missing soft-delete columns.
  try {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
    const want = String(column).toLowerCase();
    return (results || []).some(r => String(r.name || '').toLowerCase() === want);
  } catch (_) {
    return false;
  }
}

function getEventoIdFromRequest(url) {
  // Backward compatible: some UIs used festa_id; canonical is evento_id.
  return url.searchParams.get('evento_id') || url.searchParams.get('festa_id') || null;
}

export async function eventoItensAPI(request, env) {
  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  // RBAC v2 (module permissions)
  const permErr = await requirePermission(env, auth, 'eventos', actionFromHttp(request.method) || 'read');
  if (permErr) return permErr;

  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // ["api","eventos-itens",":id?"]
  const id = parts[2];

  // Detect soft-delete support on evento_itens
  const hasAtivo = await hasColumn(env, 'evento_itens', 'ativo');

  try {
    if (request.method === 'GET') {
      const eventoId = getEventoIdFromRequest(url);
      const categoria = url.searchParams.get('categoria');

      if (!eventoId) return fail(422, 'VALIDATION_ERROR', 'evento_id é obrigatório');

      // Ensure event belongs to tenant
      const ev = await env.DB
        .prepare('SELECT id FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
        .bind(eventoId, auth.empresaId)
        .first();
      if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

      let q = 'SELECT * FROM evento_itens WHERE evento_id=? AND empresa_id=?';
      const binds = [eventoId, auth.empresaId];

      if (hasAtivo) q += ' AND ativo=1';
      else q += " AND (status IS NULL OR status <> 'arquivado')";

      if (categoria) {
        q += ' AND categoria=?';
        binds.push(categoria);
      }
      q += ' ORDER BY id DESC';

      const { results } = await env.DB.prepare(q).bind(...binds).all();
      return json(results || []);
    }

    if (request.method === 'POST' && !id) {
      const parsed = await safeJsonBody(request);
      if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
      const b = parsed.body || {};

      // Backward compatible: allow festa_id in body too
      const evento_id = b.evento_id || b.festa_id;

      if (!evento_id || !b.categoria || !b.item) {
        return fail(422, 'VALIDATION_ERROR', 'Campos obrigatórios: evento_id, categoria, item');
      }

      const ev = await env.DB
        .prepare('SELECT id FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
        .bind(evento_id, auth.empresaId)
        .first();
      if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado');

      const qtd = Number(b.quantidade || 0);
      const vu = Number(b.valor_unitario || 0);
      const vt = (b.valor_total !== undefined && b.valor_total !== null) ? Number(b.valor_total) : (qtd * vu);

      if (hasAtivo) {
        const ins = await env.DB
          .prepare(`
            INSERT INTO evento_itens (
              empresa_id, evento_id, categoria, item,
              quantidade, unidade, fornecedor,
              valor_unitario, valor_total,
              status, observacao,
              ativo, criado_em, atualizado_em
            )
            VALUES (?,?,?,?,?,?,?,?,?,?,?, 1, datetime('now'), datetime('now'))
          `)
          .bind(
            auth.empresaId,
            evento_id,
            b.categoria,
            b.item,
            qtd,
            b.unidade || null,
            b.fornecedor || null,
            vu,
            vt,
            b.status || 'pendente',
            b.observacao || null
          )
          .run();

        await logAudit(env, request, auth, { modulo: 'eventos', acao: 'create', entidade: 'evento_itens', entidadeId: ins.meta.last_row_id });
        return ok({ id: ins.meta.last_row_id });
      }

      // Older DB (no ativo/atualizado_em)
      const ins = await env.DB
        .prepare(`
          INSERT INTO evento_itens (
            empresa_id, evento_id, categoria, item,
            quantidade, unidade, fornecedor,
            valor_unitario, valor_total,
            status, observacao,
            criado_em
          )
          VALUES (?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        `)
        .bind(
          auth.empresaId,
          evento_id,
          b.categoria,
          b.item,
          qtd,
          b.unidade || null,
          b.fornecedor || null,
          vu,
          vt,
          b.status || 'pendente',
          b.observacao || null
        )
        .run();

      await logAudit(env, request, auth, { modulo: 'eventos', acao: 'create', entidade: 'evento_itens', entidadeId: ins.meta.last_row_id });
      return ok({ id: ins.meta.last_row_id });
    }

    // UPDATE (PATCH/PUT) /api/eventos-itens/:id
    if ((request.method === 'PATCH' || request.method === 'PUT') && id) {
      const parsed = await safeJsonBody(request);
      if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido');
      const b = parsed.body || {};

      const whereAlive = hasAtivo ? ' AND ativo=1' : " AND (status IS NULL OR status <> 'arquivado')";

      const existing = await env.DB
        .prepare(`SELECT id FROM evento_itens WHERE id=? AND empresa_id=?${whereAlive} LIMIT 1`)
        .bind(id, auth.empresaId)
        .first();
      if (!existing) return fail(404, 'NOT_FOUND', 'Item não encontrado');

      const allow = ['categoria', 'item', 'quantidade', 'unidade', 'fornecedor', 'valor_unitario', 'valor_total', 'status', 'observacao'];
      const fields = [];
      const binds = [];

      for (const k of allow) {
        if (b[k] !== undefined) {
          fields.push(`${k}=?`);
          binds.push(b[k]);
        }
      }
      if (!fields.length) return fail(422, 'VALIDATION_ERROR', 'Nada para atualizar');

      // recalcula valor_total se necessário
      if ((b.quantidade !== undefined || b.valor_unitario !== undefined) && b.valor_total === undefined) {
        const cur = await env.DB
          .prepare('SELECT quantidade, valor_unitario FROM evento_itens WHERE id=? AND empresa_id=?')
          .bind(id, auth.empresaId)
          .first();

        const qtd = Number(b.quantidade !== undefined ? b.quantidade : (cur?.quantidade || 0));
        const vu = Number(b.valor_unitario !== undefined ? b.valor_unitario : (cur?.valor_unitario || 0));
        fields.push('valor_total=?');
        binds.push(qtd * vu);
      }

      const hasAtualizado = await hasColumn(env, 'evento_itens', 'atualizado_em');
      if (hasAtualizado) fields.push("atualizado_em=datetime('now')");

      binds.push(id, auth.empresaId);

      await env.DB
        .prepare(`UPDATE evento_itens SET ${fields.join(', ')} WHERE id=? AND empresa_id=?${whereAlive}`)
        .bind(...binds)
        .run();

      await logAudit(env, request, auth, { modulo: 'eventos', acao: 'update', entidade: 'evento_itens', entidadeId: id });
      return ok();
    }

    // ARCHIVE (soft delete)
    if (request.method === 'DELETE' && id) {
      const hasAtualizado = await hasColumn(env, 'evento_itens', 'atualizado_em');
      if (hasAtivo) {
        await env.DB
          .prepare(`UPDATE evento_itens SET ativo=0${hasAtualizado ? ", atualizado_em=datetime('now')" : ''} WHERE id=? AND empresa_id=?`)
          .bind(id, auth.empresaId)
          .run();
      } else {
        // Backward compatible soft-archive without schema change
        await env.DB
          .prepare(`UPDATE evento_itens SET status='arquivado' WHERE id=? AND empresa_id=?`)
          .bind(id, auth.empresaId)
          .run();
      }

      await logAudit(env, request, auth, { modulo: 'eventos', acao: 'delete', entidade: 'evento_itens', entidadeId: id });
      return ok();
    }

    return fail(405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  } catch (err) {
    return fail(500, 'INTERNAL_ERROR', 'Erro interno', String(err?.message || err));
  }
}
