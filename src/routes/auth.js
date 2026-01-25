// src/routes/auth.js
// Minimal, production-safe auth for Workers without external deps.
// Uses an HMAC-signed session cookie.

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function text(status = 200, body = 'OK', extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(String(input)));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSign(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(sig);
}

function getCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function setCookieHeader({ 
  name, 
  value, 
  maxAgeSeconds, 
  path = '/', 
  httpOnly = true, 
  sameSite = 'Lax', 
  secure = true,
  domain = null,
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value ?? '')}`, `Path=${path}`, `Max-Age=${maxAgeSeconds}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join('; ');
}

function cookiePolicyFromUrl(url) {
  const host = url.hostname || '';
  const isHttps = url.protocol === 'https:';
  const isProdDomain = host === 'sistema.homefesteeventos.com.br' || host.endsWith('.homefesteeventos.com.br');
  return {
    secure: isHttps,
    // Domain only for production domain(s). Never set Domain for localhost/workers.dev.
    domain: isProdDomain ? '.homefesteeventos.com.br' : null,
    sameSite: 'Lax',
    path: '/',
  };
}

function isAllowedOrigin(request, url) {
  // Basic CSRF protection for login/logout: allow same-origin and known dev origins.
  const origin = request.headers.get('Origin') || '';
  const referer = request.headers.get('Referer') || '';
  if (!origin && !referer) return true; // non-browser clients
  const allowed = new Set([
    url.origin,
    'http://localhost:8787',
    'http://127.0.0.1:8787',
  ]);
  for (const a of allowed) {
    if (origin.startsWith(a) || referer.startsWith(a)) return true;
  }
  return false;
}

function parseSessionPayload(payloadJson) {
  try {
    const p = JSON.parse(payloadJson);
    if (!p || typeof p !== 'object') return null;
    return p;
  } catch {
    return null;
  }
}

async function makeSessionCookie(env, payload) {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET não configurado');
  const jsonPayload = JSON.stringify(payload);
  const p = b64url(new TextEncoder().encode(jsonPayload));
  const sig = await hmacSign(secret, p);
  return `${p}.${sig}`;
}

async function verifySessionCookie(env, token) {
  const secret = env.SESSION_SECRET;
  if (!secret || !token) return { ok: false };
  const [p, sig] = token.split('.');
  if (!p || !sig) return { ok: false };
  const expected = await hmacSign(secret, p);
  if (expected !== sig) return { ok: false };
  const payloadJson = new TextDecoder().decode(b64urlToBytes(p));
  const payload = parseSessionPayload(payloadJson);
  if (!payload) return { ok: false };
  // exp (unix seconds)
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) return { ok: false };
  return { ok: true, payload };
}

export async function requireAuth(request, env, opts = { redirectOnFail: true }) {
  const url = new URL(request.url);
  const token = getCookie(request, 'hf_session');
  const verified = await verifySessionCookie(env, token);
  if (!verified.ok) {
    if (opts.redirectOnFail) {
      // for API: return 401 JSON; for pages: redirect
      if (url.pathname.startsWith('/api/')) {
        return { ok: false, res: json({ message: 'Não autenticado' }, 401) };
      }
      return { ok: false, res: Response.redirect(new URL('/login.html', url.origin).toString(), 302) };
    }
    return { ok: false, res: json({ message: 'Não autenticado' }, 401) };
  }

  // Pass auth context downstream using headers (simple & works with existing route signatures)
  const headers = new Headers(request.headers);
  headers.set('x-user', verified.payload.user || '');
  headers.set('x-user-id', String(verified.payload.user_id || 0));
  headers.set('x-perfil', verified.payload.perfil || 'admin');
  headers.set('x-empresa-id', String(verified.payload.empresa_id || 1));
  return { ok: true, headers };
}

export async function authAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/me' && request.method === 'GET') {
    const token = getCookie(request, 'hf_session');
    const verified = await verifySessionCookie(env, token);
    if (!verified.ok) return json({ ok: false }, 401);
    const payload = verified.payload || {};
    return json({
      ok: true,
      user_id: payload.user_id ?? 0,
      email: payload.email ?? '',
      nome: payload.nome ?? '',
      perfil: payload.perfil ?? 'admin',
      empresa_id: payload.empresa_id ?? 1,
      exp: payload.exp ?? null,
      iat: payload.iat ?? null,
    });
  }

  if (path === '/api/logout') {
    if (!isAllowedOrigin(request, url)) return json({ message: 'Origem não permitida.' }, 403);
    const policy = cookiePolicyFromUrl(url);
    const cookie = setCookieHeader({ name: 'hf_session', value: '', maxAgeSeconds: 0, secure: policy.secure, sameSite: policy.sameSite, path: policy.path, domain: policy.domain });
    if (path.startsWith('/api/')) return json({ ok: true }, 200, { 'Set-Cookie': cookie });
    return Response.redirect(new URL('/login.html', url.origin).toString(), 302, { headers: { 'Set-Cookie': cookie } });
  }

  if (path === '/api/login' && request.method === 'POST') {
    if (!env.SESSION_SECRET) {
      return json({ message: 'SESSION_SECRET não configurado no Workers.' }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const emailOrUser = String(body.email || body.user || '').trim().toLowerCase();
    const pass = String(body.senha || body.pass || '');

    if (!emailOrUser || !pass) {
      return json({ message: 'Informe email e senha.' }, 400);
    }

    const now = Math.floor(Date.now() / 1000);

    // 1) Prefer DB users (email+senha)
    if (env.DB) {
      try {
        // Ensure tables exist (migration should have created them)
        const row = await env.DB.prepare(
          "SELECT id, empresa_id, nome, email, senha_hash, salt, perfil, ativo FROM usuarios WHERE lower(email)=? LIMIT 1"
        ).bind(emailOrUser).first();

        if (row && Number(row.ativo) === 1) {
          const salt = row.salt ? String(row.salt) : '';
          // New users: senha_hash = sha256(salt:senha). Legacy: senha_hash may be plain sha256(senha)
          const candidate = salt ? await sha256Hex(`${salt}:${pass}`) : await sha256Hex(pass);

          if (candidate === String(row.senha_hash)) {
            const payload = {
              user_id: row.id,
              email: row.email,
              nome: row.nome,
              perfil: row.perfil || 'vendas',
              empresa_id: row.empresa_id || 1,
              iat: now,
              exp: now + 60 * 60 * 12, // 12h
            };

            const token = await makeSessionCookie(env, payload);
            const policy = cookiePolicyFromUrl(url);
            const cookie = setCookieHeader({ name: 'hf_session', value: token, maxAgeSeconds: 60 * 60 * 12, secure: policy.secure, sameSite: policy.sameSite, path: policy.path, domain: policy.domain });
            return json({ ok: true, redirect: '/' }, 200, { 'Set-Cookie': cookie });
          }

          return json({ message: 'Email ou senha inválidos.' }, 401);
        }

        if (row && Number(row.ativo) !== 1) {
          return json({ message: 'Usuário inativo.' }, 403);
        }
        // if not found, fall through to admin bootstrap
      } catch (e) {
        // ignore DB errors and fall back to admin bootstrap
      }
    }

    // 2) Admin bootstrap via env vars (fallback / first access)
    const adminUser = String(env.ADMIN_USER || 'admin').toLowerCase();
    const adminPassSha = String(env.ADMIN_PASS_SHA256 || '');

    if (!adminPassSha) {
      return json({
        message: 'ADMIN_PASS_SHA256 não configurado. Configure via wrangler secret/vars antes de usar o login.'
      }, 500);
    }

    const passSha = await sha256Hex(pass);
    const userTyped = emailOrUser;

    // Accept "admin" or "admin@..." for bootstrap
    const isAdminUser = (userTyped === adminUser) || (userTyped === `${adminUser}@homefest.local`);

    if (!isAdminUser || passSha !== adminPassSha) {
      return json({ message: 'Email ou senha inválidos.' }, 401);
    }

    // If DB is available, auto-provision empresa/user on first bootstrap
    if (env.DB) {
      try {
        // Ensure empresa id=1 exists
        await env.DB.prepare(
          "INSERT INTO empresa (id, nome) SELECT 1, 'Home Fest & Eventos' WHERE NOT EXISTS (SELECT 1 FROM empresa WHERE id=1)"
        ).run();

        const adminEmail = userTyped.includes('@') ? userTyped : `${adminUser}@homefest.local`;

        // Create admin user if missing
        const exists = await env.DB.prepare(
          "SELECT id FROM usuarios WHERE lower(email)=? LIMIT 1"
        ).bind(adminEmail.toLowerCase()).first();

        if (!exists) {
          await env.DB.prepare(
            "INSERT INTO usuarios (empresa_id, nome, email, senha_hash, salt, perfil, ativo) VALUES (1, ?, ?, ?, NULL, 'admin', 1)"
          ).bind('Administrador', adminEmail.toLowerCase(), adminPassSha).run();
        }
      } catch (e) {
        // ignore bootstrap errors
      }
    }

    const payload = {
      user_id: 0,
      email: isAdminUser ? (userTyped.includes('@') ? userTyped : `${adminUser}@homefest.local`) : userTyped,
      nome: 'Administrador',
      perfil: 'admin',
      empresa_id: 1,
      iat: now,
      exp: now + 60 * 60 * 12, // 12h
    };

    const token = await makeSessionCookie(env, payload);
    const policy = cookiePolicyFromUrl(url);
            const cookie = setCookieHeader({ name: 'hf_session', value: token, maxAgeSeconds: 60 * 60 * 12, secure: policy.secure, sameSite: policy.sameSite, path: policy.path, domain: policy.domain });
    return json({ ok: true, redirect: '/' }, 200, { 'Set-Cookie': cookie });
  }

  return text(404, 'Not Found');
}
