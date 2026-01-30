import { leadsAPI } from './routes/leads.js';
import { clientesAPI } from './routes/clientes.js';
import { eventosAPI } from './routes/eventos.js';
import { eventoItensAPI } from './routes/evento_itens.js';
import { financeiroAPI } from './routes/financeiro.js';
import { dashboardAPI } from './routes/dashboard.js';
import { authAPI, requireAuth } from './routes/auth.js';
import { usuariosAPI } from './routes/usuarios.js';
import { propostasAPI } from './routes/propostas.js';
import { permissoesAPI } from './routes/permissoes.js';
import { contratosAPI } from './routes/contratos.js';
import { equipeAPI } from './routes/equipe.js';
import { adminRouter } from './routes/admin.js';

const BUILD_ID = '20260128-150000'; // build marker (UTC), avoids env dependency

function applySecurityHeaders(res) {
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  const ct = headers.get('content-type') || '';
  // Avoid caching for HTML and API responses to prevent "ghost" UI/data.
  // Also avoid caching redirects, because a cached redirect can drop query strings and break UI flows.
    if (res.status >= 300 && res.status < 400) {
    headers.set('Cache-Control', 'no-store');
  } else if (
    ct.includes('text/html') ||
    ct.includes('application/json') ||
    ct.includes('text/css') ||
    ct.includes('javascript')
  ) {
    // Ensure clients always pick up new UI/code in production without relying on stale caches.
    headers.set('Cache-Control', 'no-store');
  } else if (ct.includes('text/html') || ct.includes('application/json')) {
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env) {
    // IMPORTANT: never allow unhandled exceptions to bubble to Cloudflare
    // (which shows Error 1101). All failures must return controlled responses.
    try {
      let url = new URL(request.url);
      // Compatibility: some UIs expect /api/financeiro/caixa/resumo, but backend exposes /api/financeiro/caixa
      // We rewrite it to keep production stable without schema changes.
      if (url.pathname === '/api/financeiro/caixa/resumo') {
        const u2 = new URL(request.url);
        u2.pathname = '/api/financeiro/caixa';
        request = new Request(u2.toString(), request);
        url = u2;
      }
      // Legacy compatibility: old UIs used /api/evento_itens (underscore) but backend route is /api/eventos-itens
      if (url.pathname === '/api/evento_itens' || url.pathname.startsWith('/api/evento_itens/')) {
        const u3 = new URL(request.url);
        u3.pathname = u3.pathname.replace('/api/evento_itens', '/api/eventos-itens');
        request = new Request(u3.toString(), request);
        url = new URL(request.url);
      }


    // Auth endpoints (public)
    if (url.pathname.startsWith('/api/login') || url.pathname.startsWith('/api/logout') || url.pathname.startsWith('/api/me')) {
      return applySecurityHeaders(await authAPI(request, env));
    }

    // Public contract acceptance API (no session)
    if (url.pathname.startsWith('/api/contratos/aceite')) {
      return applySecurityHeaders(await contratosAPI(request, env));
    }

    // Logout shortcut for UI
    // IMPORTANT: GET /logout must NOT clear the session cookie. It is too easy for
    // accidental navigations (ghost clicks / overlaps / prefetch) to hit this URL.
    // We only allow POST to perform the logout.
    if (url.pathname === '/logout') {
      if (request.method !== 'POST') {
        return applySecurityHeaders(Response.redirect(new URL('/', url.origin).toString(), 302));
      }
      // Proxy to POST /api/logout
      const proxyReq = new Request(new URL('/api/logout', url.origin).toString(), {
        method: 'POST',
        headers: request.headers,
      });
      return applySecurityHeaders(await authAPI(proxyReq, env));
    }

    // Protect all /api/* except /api/login
    let authCtx = null;
    if (url.pathname.startsWith('/api/')) {
      // API version endpoint
      if (url.pathname === '/api/version') {
        return applySecurityHeaders(new Response(JSON.stringify({ ok: true, build: BUILD_ID, ts: Date.now() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }));
      }

      authCtx = await requireAuth(request, env);
      if (!authCtx.ok) return applySecurityHeaders(authCtx.res);
      // Inject auth context headers for downstream route handlers
      request = new Request(request, { headers: authCtx.headers });
    }

    // Protect app pages (SPA) except login assets
    const isPublic = (
      url.pathname === '/login.html' ||
      url.pathname === '/auth.js' ||
      url.pathname === '/auth.css' ||
      url.pathname === '/favicon.ico' ||
      url.pathname === '/aceite-contrato.html' ||
      url.pathname === '/' // allow root to be handled below (redirect if needed)
    );

    if (!isPublic) {
      // Only gate HTML pages and app assets (optional hardening)
      if (url.pathname.startsWith('/app/') || url.pathname.endsWith('.html')) {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return applySecurityHeaders(auth.res);
      }
    }

    // Root: redirect to app if logged in, else to login
if (url.pathname === '/') {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return applySecurityHeaders(auth.res); // requireAuth already redirects to login on 401
  return applySecurityHeaders(Response.redirect(new URL('/app/dashboard', url.origin).toString(), 302));
}


// Legacy hardening: block old standalone HTML endpoints (if ever referenced)
const legacyHtml = new Set([
  '/dashboard.html','/leads.html','/clientes.html','/festas.html','/festa.html','/financeiro.html','/usuarios.html','/permissoes.html'
]);
if (legacyHtml.has(url.pathname)) {
  const auth = await requireAuth(request, env);
  if (!auth.ok) return applySecurityHeaders(auth.res);
  return applySecurityHeaders(Response.redirect(new URL('/app/dashboard', url.origin).toString(), 302));
}

// Pretty URLs (no .html) -> legacy pages (stable)
const prettyMap = {
  '/login': '/login.html',
  // Legacy pages (stable). Avoid SPA shell.
  '/app': '/app/dashboard.html',
  '/app/dashboard': '/app/dashboard.html',
  '/app/leads': '/app/leads.html',
  '/app/clientes': '/app/clientes.html',
  '/app/festas': '/app/festas2.html',
  '/app/eventos': '/app/festas2.html', // alias
  '/app/festa': '/app/festa2.html',
  '/app/financeiro': '/app/financeiro.html',
  '/app/usuarios': '/app/usuarios.html',
  '/app/permissoes': '/app/permissoes.html',
  '/aceite-contrato': '/aceite-contrato.html',
};
const redirectWithQuery = (path) => {
  const target = new URL(path, url.origin);
  target.search = url.search;
  return applySecurityHeaders(Response.redirect(target.toString(), 302));
};
if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
  const p = url.pathname.slice(0, -1);
  if (prettyMap[p]) return redirectWithQuery(prettyMap[p]);
} else if (prettyMap[url.pathname]) {
  return redirectWithQuery(prettyMap[url.pathname]);
}

    if (url.pathname.startsWith('/api/usuarios')) return applySecurityHeaders(await usuariosAPI(request, env, authCtx));
    if (url.pathname.startsWith('/api/leads')) return applySecurityHeaders(await leadsAPI(request, env));
    if (url.pathname.startsWith('/api/clientes')) return applySecurityHeaders(await clientesAPI(request, env));
    if (url.pathname.startsWith('/api/equipe')) return applySecurityHeaders(await equipeAPI(request, env));
    if (url.pathname.startsWith('/api/eventos-itens')) return applySecurityHeaders(await eventoItensAPI(request, env));
    if (url.pathname.startsWith('/api/eventos')) return applySecurityHeaders(await eventosAPI(request, env));
    if (url.pathname.startsWith('/api/financeiro')) return applySecurityHeaders(await financeiroAPI(request, env));
    if (url.pathname.startsWith('/api/dashboard')) return applySecurityHeaders(await dashboardAPI(request, env));
    if (url.pathname.startsWith('/api/propostas')) return applySecurityHeaders(await propostasAPI(request, env));
    if (url.pathname.startsWith('/api/contratos')) return applySecurityHeaders(await contratosAPI(request, env));
    if (url.pathname.startsWith('/api/permissoes')) return applySecurityHeaders(await permissoesAPI(request, env));
    if (url.pathname.startsWith('/api/admin/')) return applySecurityHeaders(await adminRouter(request, env));

      const assetRes = await env.ASSETS.fetch(request);
      return applySecurityHeaders(assetRes);
    } catch (err) {
      const url = (() => { try { return new URL(request.url); } catch { return null; } })();
      const isApi = !!url && url.pathname.startsWith('/api/');
      // Avoid leaking internals, but keep a breadcrumb for debugging.
      const msg = (err && (err.stack || err.message)) ? String(err.stack || err.message) : 'Unknown error';
      console.error('UNHANDLED_ERROR', { path: url?.pathname, msg });

      if (isApi) {
        return applySecurityHeaders(new Response(JSON.stringify({ ok: false, error: 'internal_error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        }));
      }

      return applySecurityHeaders(new Response(
        `Erro interno ao processar a requisição.\n\nRay/Path: ${url?.pathname || ''}`,
        { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
      ));
    }
  }
};
