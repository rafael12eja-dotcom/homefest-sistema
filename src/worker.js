import { leadsAPI } from './routes/leads.js';
import { clientesAPI } from './routes/clientes.js';
import { eventosAPI } from './routes/eventos.js';
import { eventoItensAPI } from './routes/evento_itens.js';
import { financeiroAPI } from './routes/financeiro.js';
import { dashboardAPI } from './routes/dashboard.js';
import { authAPI, requireAuth } from './routes/auth.js';
import { usuariosAPI } from './routes/usuarios.js';
import { propostasAPI } from './routes/propostas.js';

function applySecurityHeaders(res) {
  const headers = new Headers(res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  const ct = headers.get('content-type') || '';
  // Avoid caching for HTML and API responses to prevent "ghost" UI/data.
  if (ct.includes('text/html') || ct.includes('application/json')) {
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Auth endpoints (public)
    if (url.pathname.startsWith('/api/login') || url.pathname.startsWith('/api/logout') || url.pathname.startsWith('/api/me')) {
      return applySecurityHeaders(await authAPI(request, env));
    }

    // Logout shortcut for UI
    if (url.pathname === '/logout') {
      return applySecurityHeaders(await authAPI(new Request(new URL('/api/logout', url.origin).toString(), request), env));
    }

    // Protect all /api/* except /api/login
    let authCtx = null;
    if (url.pathname.startsWith('/api/')) {
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
      url.pathname === '/' // allow root to be handled below (redirect if needed)
    );

    if (!isPublic) {
      // Only gate HTML pages and app assets (optional hardening)
      if (url.pathname.startsWith('/app/') || url.pathname.endsWith('.html')) {
        const auth = await requireAuth(request, env);
        if (!auth.ok) return applySecurityHeaders(auth.res);
      }
    }

    // Root: redirect to dashboard if logged in, else to login
    if (url.pathname === '/') {
      const auth = await requireAuth(request, env, { redirectOnFail: false });
      if (!auth.ok) return applySecurityHeaders(Response.redirect(new URL('/login.html', url.origin).toString(), 302));
      return applySecurityHeaders(Response.redirect(new URL('/index.html', url.origin).toString(), 302));
    }
    // Pretty URLs (no .html) -> real .html pages (prevents broken buttons/menus)
    const prettyMap = {
      '/login': '/login.html',
      '/app': '/index.html',
      '/app/dashboard': '/index.html',
      '/app/dashboard.html': '/index.html',
      '/app/leads': '/app/leads.html',
      '/app/clientes': '/app/clientes.html',
      '/app/festas': '/app/festas.html',
      '/app/festa': '/app/festa.html',
      '/app/financeiro': '/app/financeiro.html',
      '/app/usuarios': '/app/usuarios.html',
    };
    const redirectWithQuery = (path) => {
      const target = new URL(path, url.origin);
      // Preserve query string so routes like /app/festas?action=create keep working.
      target.search = url.searchParams.toString();
      return applySecurityHeaders(Response.redirect(target.toString(), 302));
    };
    // normalize trailing slash
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      const p = url.pathname.slice(0, -1);
      if (prettyMap[p]) return redirectWithQuery(prettyMap[p]);
      // if removing slash matches an asset, let it continue
    } else if (prettyMap[url.pathname]) {
      return redirectWithQuery(prettyMap[url.pathname]);
    }



    if (url.pathname.startsWith('/api/usuarios')) return applySecurityHeaders(await usuariosAPI(request, env, authCtx));
    if (url.pathname.startsWith('/api/leads')) return applySecurityHeaders(await leadsAPI(request, env));
    if (url.pathname.startsWith('/api/clientes')) return applySecurityHeaders(await clientesAPI(request, env));
    if (url.pathname.startsWith('/api/eventos-itens')) return applySecurityHeaders(await eventoItensAPI(request, env));
    if (url.pathname.startsWith('/api/eventos')) return applySecurityHeaders(await eventosAPI(request, env));
    if (url.pathname.startsWith('/api/financeiro')) return applySecurityHeaders(await financeiroAPI(request, env));
    if (url.pathname.startsWith('/api/dashboard')) return applySecurityHeaders(await dashboardAPI(request, env));
    if (url.pathname.startsWith('/api/propostas')) return applySecurityHeaders(await propostasAPI(request, env));

    const assetRes = await env.ASSETS.fetch(request);
    return applySecurityHeaders(assetRes);
  }
};
