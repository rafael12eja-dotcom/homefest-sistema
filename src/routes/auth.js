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


function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomB64url(bytesLen = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(bytesLen));
  return b64url(bytes);
}

async function pbkdf2Derive(pass, saltB64, iterations = 150000) {
  const salt = b64urlToBytes(String(saltB64));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(pass)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return b64url(bits);
}

// Stored format: pbkdf2$<iterations>$<saltB64url>$<hashB64url>
function parseStoredPasswordHash(stored) {
  const s = String(stored || '');
  if (!s.startsWith('pbkdf2$')) return null;
  const parts = s.split('$');
  if (parts.length !== 4) return null;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 50000) return null;
  return { iterations, salt: parts[2], hash: parts[3] };
}

async function verifyPassword(pass, storedHash, legacySalt) {
  const parsed = parseStoredPasswordHash(storedHash);
  if (parsed) {
    const candidate = await pbkdf2Derive(pass, parsed.salt, parsed.iterations);
    return candidate === parsed.hash;
  }
  // Legacy: sha256(salt:pass) or sha256(pass)
  const salt = legacySalt ? String(legacySalt) : '';
  const candidate = salt ? await sha256Hex(`${salt}:${pass}`) : await sha256Hex(pass);
  return candidate === String(storedHash || '');
}

async function hashPassword(pass, iterations = 150000) {
  const salt = randomB64url(16);
  const hash = await pbkdf2Derive(pass, salt, iterations);
  return `pbkdf2$${iterations}$${salt}$${hash}`;
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


function getClientIp(request) {
  // Cloudflare provides CF-Connecting-IP; fallback to X-Forwarded-For
  const cfip = request.headers.get('CF-Connecting-IP');
  if (cfip) return cfip.split(',')[0].trim();
  const xff = request.headers.get('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim();
  return '0.0.0.0';
}

async function isLoginRateLimited(env, ip, emailLower) {
  if (!env.DB) return false;
  // Policy: max 5 failed attempts for (ip,email) in 15 minutes OR 25 failed attempts per IP in 15 minutes
  try {
    const row1 = await env.DB.prepare(
      "SELECT COUNT(1) AS c FROM login_attempts WHERE ip=? AND email=? AND success=0 AND criado_em > datetime('now','-15 minutes')"
    ).bind(ip, emailLower).first();
    const row2 = await env.DB.prepare(
      "SELECT COUNT(1) AS c FROM login_attempts WHERE ip=? AND success=0 AND criado_em > datetime('now','-15 minutes')"
    ).bind(ip).first();
    const c1 = Number(row1?.c || 0);
    const c2 = Number(row2?.c || 0);
    return c1 >= 5 || c2 >= 25;
  } catch (_) {
    // Fail-open on rate limit storage errors to avoid locking users out
    return false;
  }
}

async function recordLoginAttempt(env, ip, emailLower, success) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO login_attempts (ip, email, success, criado_em) VALUES (?,?,?, datetime('now'))"
    ).bind(ip, emailLower, success ? 1 : 0).run();
  } catch (_) {}
}

async function clearLoginAttempts(env, ip, emailLower) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "DELETE FROM login_attempts WHERE ip=? AND email=?"
    ).bind(ip, emailLower).run();
  } catch (_) {}
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
  // Do NOT fallback to a default tenant. Missing empresa_id must surface as an error.
  headers.set('x-perfil', verified.payload.perfil || '');
  headers.set('x-empresa-id', verified.payload.empresa_id != null ? String(verified.payload.empresa_id) : '');
  return { ok: true, headers, payload: verified.payload };
}

export async function authAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/me' && request.method === 'GET') {
    const token = getCookie(request, 'hf_session');
    const verified = await verifySessionCookie(env, token);
    if (!verified.ok) return json({ ok: false }, 401);
    const payload = verified.payload || {};

    // CRITICAL (multi-tenant): never fallback to a default empresa_id.
    // If the session payload is missing empresa_id, surfaces as null.
    return json({
      ok: true,
      user_id: payload.user_id ?? 0,
      email: payload.email ?? '',
      nome: payload.nome ?? '',
      perfil: payload.perfil ?? '',
      empresa_id: (payload.empresa_id != null ? payload.empresa_id : null),
      exp: payload.exp ?? null,
      iat: payload.iat ?? null,
    });
  }

  if (path === '/api/logout') {
    // Hard requirement: logout MUST be an explicit user action.
    // Allowing GET here makes it possible to "logout" due to accidental navigations
    // (e.g., overlap/ghost clicks in UI). We only accept POST.
    if (request.method !== 'POST') {
      // Browser navigation to /api/logout should not clear cookies.
      if (!path.startsWith('/api/')) {
        return Response.redirect(new URL('/login.html', url.origin).toString(), 302);
      }
      return json({ message: 'Method Not Allowed' }, 405);
    }
    if (!isAllowedOrigin(request, url)) return json({ message: 'Origem não permitida.' }, 403);
    // Defense-in-depth: only allow logout when explicitly initiated by our JS.
    // This prevents accidental logouts from ghost clicks/prefetches.
    if (request.headers.get('x-hf-logout') !== '1') {
      return json({ ok: true, ignored: true }, 200);
    }
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

    const ip = getClientIp(request);
    const emailKey = emailOrUser;

    // Rate limiting (defense-in-depth): prevents brute force without breaking production.
    // NOTE: Uses D1 table login_attempts (migration 015_login_attempts.sql).
    if (await isLoginRateLimited(env, ip, emailKey)) {
      return json({ message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' }, 429);
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
          const empresaId = row.empresa_id;
          if (!empresaId) {
            return json({ message: 'Usuário sem empresa vinculada. Fale com o administrador.' }, 403);
          }
          const okPass = await verifyPassword(pass, row.senha_hash, row.salt);

          if (okPass) {
            // Upgrade legacy hashes to PBKDF2 (bank-grade) on successful login
            try {
              if (!String(row.senha_hash || '').startsWith('pbkdf2$')) {
                const newHash = await hashPassword(pass);
                await env.DB.prepare(
                  "UPDATE usuarios SET senha_hash=?, salt=NULL, atualizado_em=datetime('now') WHERE id=? AND empresa_id=?"
                ).bind(newHash, row.id, empresaId).run();
              }
            } catch (_) { /* best-effort upgrade */ }

            const payload = {
              user_id: row.id,
              email: row.email,
              nome: row.nome,
              perfil: row.perfil || 'vendas',
              empresa_id: empresaId,
              iat: now,
              exp: now + 60 * 60 * 12, // 12h
            };

            await clearLoginAttempts(env, ip, emailKey);

            const token = await makeSessionCookie(env, payload);
            const policy = cookiePolicyFromUrl(url);
            const cookie = setCookieHeader({ name: 'hf_session', value: token, maxAgeSeconds: 60 * 60 * 12, secure: policy.secure, sameSite: policy.sameSite, path: policy.path, domain: policy.domain });
            return json({ ok: true, redirect: '/' }, 200, { 'Set-Cookie': cookie });
          }

          await recordLoginAttempt(env, ip, emailKey, false);
          return json({ message: 'Email ou senha inválidos.' }, 401);
        }

        if (row && Number(row.ativo) !== 1) {
          await recordLoginAttempt(env, ip, emailKey, false);
          return json({ message: 'Usuário inativo.' }, 403);
        }
        // if not found, fall through to admin bootstrap
      } catch (e) {
        // ignore DB errors and fall back to admin bootstrap
      }
    }

    // 2) Admin bootstrap via env vars (first access)
// Recommended: set ADMIN_PASS_PBKDF2 (format pbkdf2$iter$salt$hash) and ADMIN_EMPRESA_ID.
    const adminUser = String(env.ADMIN_USER || 'admin').toLowerCase();
    const adminEmpresaId = env.ADMIN_EMPRESA_ID ? Number(env.ADMIN_EMPRESA_ID) : null;
    const adminPassPbkdf2 = String(env.ADMIN_PASS_PBKDF2 || '');
    const adminPassSha = String(env.ADMIN_PASS_SHA256 || ''); // legacy (avoid if possible)

    if (!adminEmpresaId || !Number.isFinite(adminEmpresaId) || adminEmpresaId <= 0) {
      return json({ message: 'ADMIN_EMPRESA_ID não configurado. Configure para habilitar bootstrap admin.' }, 500);
    }
    if (!adminPassPbkdf2 && !adminPassSha) {
      return json({ message: 'ADMIN_PASS_PBKDF2 não configurado. Configure via wrangler secret/vars antes de usar o login.' }, 500);
    }

    const userTyped = emailOrUser;
    // Accept "admin" or "admin@..." for bootstrap
    const isAdminUser = (userTyped === adminUser) || (userTyped === `${adminUser}@homefest.local`);

    let passOk = false;
    if (adminPassPbkdf2) {
      passOk = await verifyPassword(pass, adminPassPbkdf2, null);
    } else if (adminPassSha) {
      // Legacy fallback for existing installs (keep to avoid lock-out). Prefer ADMIN_PASS_PBKDF2.
      const passSha = await sha256Hex(pass);
      passOk = (passSha === adminPassSha);
    }

    if (!isAdminUser || !passOk) {
      await recordLoginAttempt(env, ip, emailKey, false);
      return json({ message: 'Email ou senha inválidos.' }, 401);
    }

    // If DB is available, auto-provision admin user on first bootstrap (tenant-safe)
    if (env.DB) {
      try {
        const adminEmail = userTyped.includes('@') ? userTyped : `${adminUser}@homefest.local`;

        const exists = await env.DB.prepare(
          "SELECT id FROM usuarios WHERE lower(email)=? AND empresa_id=? LIMIT 1"
        ).bind(adminEmail.toLowerCase(), adminEmpresaId).first();

        if (!exists) {
          // Store PBKDF2 hash in DB regardless of legacy secret usage
          const storeHash = adminPassPbkdf2 || await hashPassword(pass);
          await env.DB.prepare(
            "INSERT INTO usuarios (empresa_id, nome, email, senha_hash, salt, perfil, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, NULL, 'admin', 1, datetime('now'), datetime('now'))"
          ).bind(adminEmpresaId, 'Administrador', adminEmail.toLowerCase(), storeHash).run();
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
      empresa_id: adminEmpresaId,
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
