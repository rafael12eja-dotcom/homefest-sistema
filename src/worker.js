import { leadsAPI } from './routes/leads.js';
import { clientesAPI } from './routes/clientes.js';
import { eventosAPI } from './routes/eventos.js';
import { eventoItensAPI } from './routes/evento_itens.js';
import { financeiroAPI } from './routes/financeiro.js';
import { dashboardAPI } from './routes/dashboard.js';
import { authAPI, requireAuth } from './routes/auth.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Auth endpoints (public)
    if (url.pathname.startsWith('/api/login') || url.pathname.startsWith('/api/logout') || url.pathname.startsWith('/api/me')) {
      return authAPI(request, env);
    }

    // Logout shortcut for UI
    if (url.pathname === '/logout') {
      return authAPI(new Request(new URL('/api/logout', url.origin).toString(), request), env);
    }

    // Protect all /api/* except /api/login
    if (url.pathname.startsWith('/api/')) {
      const auth = await requireAuth(request, env);
      if (!auth.ok) return auth.res;
      // attach auth context via request headers (cheap) - or pass along in env object
      request = new Request(request, { headers: auth.headers });
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
        if (!auth.ok) return auth.res;
      }
    }

    // Root: redirect to dashboard if logged in, else to login
    if (url.pathname === '/') {
      const auth = await requireAuth(request, env, { redirectOnFail: false });
      if (!auth.ok) return Response.redirect(new URL('/login.html', url.origin).toString(), 302);
      return Response.redirect(new URL('/app/dashboard.html', url.origin).toString(), 302);
    }

    if (url.pathname.startsWith('/api/leads')) return leadsAPI(request, env);
    if (url.pathname.startsWith('/api/clientes')) return clientesAPI(request, env);
    if (url.pathname.startsWith('/api/eventos-itens')) return eventoItensAPI(request, env);
    if (url.pathname.startsWith('/api/eventos')) return eventosAPI(request, env);
    if (url.pathname.startsWith('/api/financeiro')) return financeiroAPI(request, env);
    if (url.pathname.startsWith('/api/dashboard')) return dashboardAPI(request, env);

    return env.ASSETS.fetch(request);
  }
};
