// src/routes/usuarios.js
// CRUD de usuários (RBAC básico). Requer admin.
// NOTE: This API is hardened for production: it tolerates older schemas and avoids worker exceptions (1101).

import { requirePermission, actionFromHttp } from '../utils/rbac.js';
import { logAudit } from '../utils/audit.js';
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function getUsuariosColumns(db) {
  const rs = await db.prepare("PRAGMA table_info(usuarios)").all();
  const cols = new Set((rs.results || []).map(r => String(r.name || '').toLowerCase()));
  return cols;
}

function pickCols(cols, wanted) {
  return wanted.filter(c => cols.has(c.toLowerCase()));
}

async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomSalt() {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2,'0')).join('');
}


async function ensureEmpresaSeed(db, empresaId) {
  // Older/prod DBs may miss the seed row. This keeps FK logic consistent (even if FK pragma is on).
  try {
    await db.prepare(
      "INSERT INTO empresa (id, nome) SELECT ?, 'Home Fest & Eventos' WHERE NOT EXISTS (SELECT 1 FROM empresa WHERE id = ?)"
    ).bind(empresaId, empresaId).run();
  } catch (_) {
    // Ignore if 'empresa' table doesn't exist in an older schema.
  }
}

export async function usuariosAPI(request, env, auth) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    // RBAC v2: users module permissions (admin still allowed via rbac helper)
    const action = actionFromHttp(request.method) || 'read';
    const permErr = await requirePermission(env, { perfil: auth?.payload?.perfil, empresaId: Number(auth?.payload?.empresa_id) }, 'usuarios', action);
    if (permErr) return permErr;

    if (!env.DB) return json({ message: 'DB não configurado' }, 500);

    const empresaId = Number(auth.payload.empresa_id);

    const auditAuth = {
      userEmail: auth?.payload?.user || '',
      userId: Number(auth?.payload?.user_id || 0),
      perfil: auth?.payload?.perfil || '',
      empresaId,
    };

    if (!Number.isFinite(empresaId) || empresaId <= 0) {
      return json({ message: 'Sessão inválida: empresa_id ausente no token' }, 400);
    }


    // Ensure tenant row exists when possible (safe no-op on older schemas)
    await ensureEmpresaSeed(env.DB, empresaId);

    // GET /api/usuarios -> list
    if (path === '/api/usuarios' && request.method === 'GET') {
      const cols = await getUsuariosColumns(env.DB);
      const selectCols = pickCols(cols, ['id','empresa_id','nome','email','perfil','ativo','criado_em','atualizado_em']);
      const baseSelect = selectCols.length ? selectCols.join(', ') : 'id, nome, email';

      // Primary: tenant-filtered list
      let rs;
      try {
        rs = await env.DB.prepare(
          `SELECT ${baseSelect} FROM usuarios WHERE empresa_id = ? ORDER BY id DESC`
        ).bind(empresaId).all();
      } catch (e) {
        // Fallback if schema drift (should not throw due to selectCols, but keep it safe)
        const msg = String(e && e.message ? e.message : e);
        return json({ message: 'Erro ao listar usuários', detail: msg }, 500);
      }

      const list = rs.results || [];
      return json({ ok: true, usuarios: list });
    }


    // POST /api/usuarios -> create
    if (path === '/api/usuarios' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));

      const nome = String(body.nome || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const senha = String(body.senha || '');
      const perfil = String(body.perfil || 'vendas').trim();

      if (!nome || !email || !senha) return json({ message: 'nome, email e senha são obrigatórios' }, 400);
      if (!email.includes('@')) return json({ message: 'email inválido' }, 400);

      const cols = await getUsuariosColumns(env.DB);

      const salt = randomSalt();
      const senhaHash = await sha256Hex(`${salt}:${senha}`);

      // Build INSERT based on existing columns for backward compatibility
      const insertMap = [
        ['empresa_id', empresaId],
        ['nome', nome],
        ['email', email],
        ['senha_hash', senhaHash],
        ['salt', salt],
        ['perfil', perfil],
        ['ativo', 1],
      ].filter(([col]) => cols.has(String(col).toLowerCase()));

      // If schema is very old and misses auth columns, fail loudly with a clear error.
      const required = ['empresa_id','nome','email'];
      for (const r of required) {
        if (!cols.has(r)) return json({ message: `Schema antigo: coluna ausente '${r}' na tabela usuarios` }, 500);
      }
      if (!cols.has('senha_hash')) return json({ message: "Schema antigo: coluna ausente 'senha_hash' na tabela usuarios. Rode migrations." }, 500);

      const colNames = insertMap.map(([c]) => c);
      const placeholders = insertMap.map(() => '?').join(', ');
      const values = insertMap.map(([,v]) => v);

            try {
        const info = await env.DB.prepare(
          `INSERT INTO usuarios (${colNames.join(', ')}) VALUES (${placeholders})`
        ).bind(...values).run();

        // D1 meta field can vary; resolve the inserted id robustly.
        let newId = info?.meta?.last_row_id;
        if (!newId) {
          try {
            const rsId = await env.DB.prepare("SELECT last_insert_rowid() AS id").all();
            newId = (rsId.results || [])[0]?.id;
          } catch (_) {}
        }

        // Fetch created row (best-effort). If id is unknown, fallback by email.
        const selectCols = pickCols(cols, ['id','empresa_id','nome','email','perfil','ativo','criado_em','atualizado_em']);
        const baseSelect = selectCols.length ? selectCols.join(', ') : 'id, nome, email';

        let created = null;
        try {
          if (newId) {
            const rs = await env.DB.prepare(`SELECT ${baseSelect} FROM usuarios WHERE id = ?`).bind(newId).all();
            created = (rs.results || [])[0] || null;
          }
          if (!created) {
            const rs = await env.DB.prepare(`SELECT ${baseSelect} FROM usuarios WHERE email = ? ORDER BY id DESC LIMIT 1`).bind(email).all();
            created = (rs.results || [])[0] || null;
            if (!newId && created?.id) newId = created.id;
          }
        } catch (_) {}

        // Also return a refreshed list so UI can show the new user immediately.
        // First try tenant-filtered list; if empty, return a sample without tenant filter (admin-only).
        let list = [];
        let warning;
        try {
          const rsList = await env.DB.prepare(`SELECT ${baseSelect} FROM usuarios WHERE empresa_id = ? ORDER BY id DESC`).bind(empresaId).all();
          list = rsList.results || [];
          if (!list.length) {
            const rsAll = await env.DB.prepare(`SELECT ${baseSelect} FROM usuarios ORDER BY id DESC LIMIT 50`).all();
            list = rsAll.results || [];
            if (list.length) warning = 'tenant_mismatch_or_seed';
          }
        } catch (_) {}

        await logAudit(env, request, auditAuth, { modulo: 'usuarios', acao: 'create', entidade: 'usuarios', entidadeId: newId || null });
        return json({ ok: true, id: newId || null, usuario: created, usuarios: list, warning });
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (msg.toLowerCase().includes('unique')) return json({ message: 'Já existe um usuário com esse email' }, 409);
        return json({ message: 'Erro ao criar usuário', detail: msg }, 500);
      }
    }

    // PATCH /api/usuarios/:id -> update
    const m = path.match(/^\/api\/usuarios\/(\d+)$/);
    if (m && request.method === 'PATCH') {
      const id = Number(m[1]);
      const body = await request.json().catch(() => ({}));

      const colsU = await getUsuariosColumns(env.DB);

      const fields = [];
      const binds = [];

      if (body.nome !== undefined && colsU.has('nome')) { fields.push('nome = ?'); binds.push(String(body.nome || '').trim()); }
      if (body.email !== undefined && colsU.has('email')) { fields.push('email = ?'); binds.push(String(body.email || '').trim().toLowerCase()); }
      if (body.perfil !== undefined && colsU.has('perfil')) { fields.push('perfil = ?'); binds.push(String(body.perfil || 'vendas').trim()); }
      if (body.ativo !== undefined && colsU.has('ativo')) { fields.push('ativo = ?'); binds.push(body.ativo ? 1 : 0); }

      if (!fields.length) return json({ message: 'Nada para atualizar' }, 400);

      if (colsU.has('atualizado_em')) fields.push("atualizado_em = datetime('now')");

      // IMPORTANT: keep tenant filter if column exists; otherwise allow update by id only (legacy).
      const hasEmpresa = colsU.has('empresa_id');
      if (hasEmpresa) {
        binds.push(empresaId);
        binds.push(id);
      } else {
        binds.push(id);
      }

      try {
        const q = hasEmpresa
          ? `UPDATE usuarios SET ${fields.join(', ')} WHERE empresa_id = ? AND id = ?`
          : `UPDATE usuarios SET ${fields.join(', ')} WHERE id = ?`;
        const info = await env.DB.prepare(q).bind(...binds).run();
        if ((info.meta?.changes || 0) === 0) return json({ message: 'Usuário não encontrado' }, 404);
                await logAudit(env, request, auditAuth, { modulo: 'usuarios', acao: 'update', entidade: 'usuarios', entidadeId: id });
        return json({ ok: true });
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        if (msg.toLowerCase().includes('unique')) return json({ message: 'Email já em uso' }, 409);
        return json({ message: 'Erro ao atualizar usuário', detail: msg }, 500);
      }
    }

    // POST /api/usuarios/:id/reset-password
    const r = path.match(/^\/api\/usuarios\/(\d+)\/reset-password$/);
    if (r && request.method === 'POST') {
      const id = Number(r[1]);
      const body = await request.json().catch(() => ({}));
      const senha = String(body.senha || '');
      if (!senha) return json({ message: 'senha é obrigatória' }, 400);

      const colsU = await getUsuariosColumns(env.DB);
      if (!colsU.has('senha_hash')) return json({ message: "Schema antigo: coluna ausente 'senha_hash' na tabela usuarios." }, 500);

      const salt = randomSalt();
      const senhaHash = await sha256Hex(`${salt}:${senha}`);

      const hasEmpresa = colsU.has('empresa_id');
      const q = colsU.has('atualizado_em')
        ? (hasEmpresa
            ? `UPDATE usuarios SET senha_hash = ?, salt = ?, atualizado_em = datetime('now') WHERE empresa_id = ? AND id = ?`
            : `UPDATE usuarios SET senha_hash = ?, salt = ?, atualizado_em = datetime('now') WHERE id = ?`)
        : (hasEmpresa
            ? `UPDATE usuarios SET senha_hash = ?, salt = ? WHERE empresa_id = ? AND id = ?`
            : `UPDATE usuarios SET senha_hash = ?, salt = ? WHERE id = ?`);

      const binds = [];
      binds.push(senhaHash, salt);
      if (hasEmpresa) binds.push(empresaId, id);
      else binds.push(id);

      const info = await env.DB.prepare(q).bind(...binds).run();
      if ((info.meta?.changes || 0) === 0) return json({ message: 'Usuário não encontrado' }, 404);
      return json({ ok: true });
    }

    return json({ message: 'Not Found' }, 404);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    return json({ message: 'Erro interno', detail: msg }, 500);
  }
}