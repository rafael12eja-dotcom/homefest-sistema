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

function setCookieHeader({ name, value, maxAgeSeconds, path = '/', httpOnly = true, sameSite = 'Lax', secure = true }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `Max-Age=${maxAgeSeconds}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
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
    const { user, perfil, empresa_id, exp } = verified.payload;
    return json({ ok: true, user, perfil, empresa_id, exp });
  }

  if (path === '/api/logout') {
    const cookie = setCookieHeader({ name: 'hf_session', value: '', maxAgeSeconds: 0 });
    if (path.startsWith('/api/')) return json({ ok: true }, 200, { 'Set-Cookie': cookie });
    return Response.redirect(new URL('/login.html', url.origin).toString(), 302, { headers: { 'Set-Cookie': cookie } });
  }

  if (path === '/api/login' && request.method === 'POST') {
    if (!env.SESSION_SECRET) {
      return json({ message: 'SESSION_SECRET não configurado no Workers.' }, 500);
    }

    const body = await request.json().catch(() => ({}));
    const user = String(body.user || '').trim();
    const pass = String(body.pass || '');

    // Admin bootstrap via env vars
    const adminUser = String(env.ADMIN_USER || 'admin');
    const adminPassSha = String(env.ADMIN_PASS_SHA256 || '');

    if (!adminPassSha) {
      return json({
        message: 'ADMIN_PASS_SHA256 não configurado. Configure via wrangler secret/vars antes de usar o login.'
      }, 500);
    }

    const passSha = await sha256Hex(pass);
    if (user !== adminUser || passSha !== adminPassSha) {
      return json({ message: 'Usuário ou senha inválidos.' }, 401);
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      user,
      perfil: 'admin',
      empresa_id: 1,
      iat: now,
      exp: now + 60 * 60 * 12, // 12h
    };

    const token = await makeSessionCookie(env, payload);
    const cookie = setCookieHeader({ name: 'hf_session', value: token, maxAgeSeconds: 60 * 60 * 12 });
    return json({ ok: true, redirect: '/app/dashboard.html' }, 200, { 'Set-Cookie': cookie });
  }

  return text(404, 'Not Found');
}
