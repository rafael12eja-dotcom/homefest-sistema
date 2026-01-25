// src/routes/usuarios.js
// CRUD de usuários (RBAC básico). Requer admin.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
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

async function requireAdmin(auth) {
  if (!auth?.payload) return { ok: false, res: json({ message: 'Não autenticado' }, 401) };
  if (auth.payload.perfil !== 'admin') return { ok: false, res: json({ message: 'Sem permissão' }, 403) };
  return { ok: true };
}

export async function usuariosAPI(request, env, auth) {
  const url = new URL(request.url);
  const path = url.pathname;

  // All endpoints require admin
  const adm = await requireAdmin(auth);
  if (!adm.ok) return adm.res;

  if (!env.DB) return json({ message: 'DB não configurado' }, 500);

  // GET /api/usuarios -> lista
  if (path === '/api/usuarios' && request.method === 'GET') {
    const empresaId = Number(auth.payload.empresa_id || 1);
    const rs = await env.DB.prepare(
      'SELECT id, empresa_id, nome, email, perfil, ativo, criado_em, atualizado_em FROM usuarios WHERE empresa_id = ? ORDER BY id DESC'
    ).bind(empresaId).all();
    return json({ ok: true, usuarios: rs.results || [] });
  }

  // POST /api/usuarios -> cria
  if (path === '/api/usuarios' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const empresaId = Number(auth.payload.empresa_id || 1);

    const nome = String(body.nome || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const senha = String(body.senha || '');
    const perfil = String(body.perfil || 'vendas').trim();

    if (!nome || !email || !senha) return json({ message: 'nome, email e senha são obrigatórios' }, 400);
    if (!email.includes('@')) return json({ message: 'email inválido' }, 400);

    const salt = randomSalt();
    const senhaHash = await sha256Hex(`${salt}:${senha}`);

    try {
      const info = await env.DB.prepare(
        `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, salt, perfil, ativo)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      ).bind(empresaId, nome, email, senhaHash, salt, perfil).run();

      return json({ ok: true, id: info.meta?.last_row_id });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.toLowerCase().includes('unique')) return json({ message: 'Já existe um usuário com esse email' }, 409);
      return json({ message: 'Erro ao criar usuário', detail: msg }, 500);
    }
  }

  // PATCH /api/usuarios/:id -> atualiza perfil/ativo/nome/email (sem senha)
  const m = path.match(/^\/api\/usuarios\/(\d+)$/);
  if (m && request.method === 'PATCH') {
    const id = Number(m[1]);
    const body = await request.json().catch(() => ({}));
    const empresaId = Number(auth.payload.empresa_id || 1);

    const fields = [];
    const binds = [];

    if (body.nome !== undefined) { fields.push('nome = ?'); binds.push(String(body.nome || '').trim()); }
    if (body.email !== undefined) { fields.push('email = ?'); binds.push(String(body.email || '').trim().toLowerCase()); }
    if (body.perfil !== undefined) { fields.push('perfil = ?'); binds.push(String(body.perfil || 'vendas').trim()); }
    if (body.ativo !== undefined) { fields.push('ativo = ?'); binds.push(body.ativo ? 1 : 0); }

    if (!fields.length) return json({ message: 'Nada para atualizar' }, 400);

    fields.push("atualizado_em = datetime('now')");
    binds.push(empresaId);
    binds.push(id);

    try {
      const q = `UPDATE usuarios SET ${fields.join(', ')} WHERE empresa_id = ? AND id = ?`;
      const info = await env.DB.prepare(q).bind(...binds).run();
      if ((info.meta?.changes || 0) === 0) return json({ message: 'Usuário não encontrado' }, 404);
      return json({ ok: true });
    } catch (e) {
      const msg = String(e && e.message ? e.message : e);
      if (msg.toLowerCase().includes('unique')) return json({ message: 'Email já em uso' }, 409);
      return json({ message: 'Erro ao atualizar usuário', detail: msg }, 500);
    }
  }

  // POST /api/usuarios/:id/reset-password -> redefine senha
  const r = path.match(/^\/api\/usuarios\/(\d+)\/reset-password$/);
  if (r && request.method === 'POST') {
    const id = Number(r[1]);
    const body = await request.json().catch(() => ({}));
    const empresaId = Number(auth.payload.empresa_id || 1);
    const senha = String(body.senha || '');
    if (!senha) return json({ message: 'senha é obrigatória' }, 400);

    const salt = randomSalt();
    const senhaHash = await sha256Hex(`${salt}:${senha}`);

    const info = await env.DB.prepare(
      `UPDATE usuarios SET senha_hash = ?, salt = ?, atualizado_em = datetime('now')
       WHERE empresa_id = ? AND id = ?`
    ).bind(senhaHash, salt, empresaId, id).run();

    if ((info.meta?.changes || 0) === 0) return json({ message: 'Usuário não encontrado' }, 404);
    return json({ ok: true });
  }

  return json({ message: 'Not Found' }, 404);
}
