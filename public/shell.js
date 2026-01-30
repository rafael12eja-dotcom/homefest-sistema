/* public/shell.js
   Shared shell behaviors for legacy modules using the Premium Dark sidebar.
   - Auth gate (client-side safety): if /api/me fails, redirect to /login.html
   - Logout action
   - No framework dependencies
*/

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Accept": "application/json" },
    ...options,
  });

  // Never cache auth-sensitive responses
  // (Worker also sets no-store; this is a client-side safety net)
  return res;
}

function ensureToastHost() {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    host.style.position = 'fixed';
    host.style.bottom = '18px';
    host.style.left = '18px';
    host.style.zIndex = '99999';
    host.style.display = 'flex';
    host.style.flexDirection = 'column';
    host.style.gap = '10px';
    document.body.appendChild(host);
  }
  return host;
}

function toast(message) {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.textContent = message;
  el.style.maxWidth = '440px';
  el.style.padding = '12px 14px';
  el.style.borderRadius = '14px';
  el.style.border = '1px solid rgba(255,255,255,.12)';
  el.style.background = 'rgba(15, 23, 42, .92)';
  el.style.color = '#fff';
  el.style.boxShadow = '0 10px 30px rgba(0,0,0,.35)';
  el.style.fontWeight = '600';
  el.style.fontSize = '14px';
  host.appendChild(el);
  setTimeout(() => { el.remove(); }, 4200);
}


// Expose toast for page scripts (safe; used for non-auth errors)
window.hfToast = toast;
window.toast = toast;

// Global JSON API helper:
// - Always uses credentials: include
// - 401 redirects to login
// - 403 shows toast and does NOT logout
// - Other errors show toast with best-effort message
// Global JSON API helper (SINGLE source of truth).
// Non-negotiable invariants:
// - Always uses credentials: include
// - 401 redirects to login
// - 403 shows toast and does NOT logout
// - Never cached (no-store)
// - MUST NEVER be redefined by modules
(function initGlobalApiHelper(){
  if (window.hfApiJson) {
    // If some legacy script already defined it, keep it (do not overwrite).
    // But ensure the legacy alias exists for backward compatibility.
    if (!window.apiJson) window.apiJson = window.hfApiJson;
    return;
  }

  async function hfApiJson(path, options = {}) {
    const res = await api(path, { cache: 'no-store', ...options });

    if (res.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${next}`);
      throw new Error('Unauthorized');
    }

    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      try { data = await res.json(); } catch { data = null; }
    } else {
      try { data = await res.text(); } catch { data = null; }
    }

    if (res.status === 403) {
      const msg = (data && typeof data === 'object' && (data.message || data.error))
        ? (data.message || data.error)
        : 'Acesso negado';
      toast(msg);
      const err = new Error(msg);
      err.status = 403;
      throw err;
    }

    if (!res.ok) {
      const msg = (data && typeof data === 'object' && (data.message || data.error))
        ? (data.message || data.error)
        : (typeof data === 'string' && data ? data : `Erro ${res.status}`);
      toast(msg);
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }

    return data;
  }

  // Define as non-writable to prevent accidental redefinition.
  try {
    Object.defineProperty(window, 'hfApiJson', { value: hfApiJson, configurable: false, writable: false });
  } catch {
    window.hfApiJson = hfApiJson;
  }

  // Backward compatibility: keep window.apiJson for older modules,
  // but always point it to the same implementation.
  try {
    Object.defineProperty(window, 'apiJson', { value: hfApiJson, configurable: false, writable: false });
  } catch {
    window.apiJson = hfApiJson;
  }
})();

// Safe init helper for legacy pages.
// Prevents duplicated listeners + supports BFCache restore (pageshow).
(function initSafeInitHelper(){
  if (window.hfInitPage) return;

  const state = window.__hf_state || (window.__hf_state = { bound: {}, ran: {} });

  function bindOnce(key, initFn) {
    if (state.bound[key]) return;
    state.bound[key] = true;

    const run = (ctx) => {
      // Init should run once per page load; on BFCache restore we call refresh if provided.
      if (state.ran[key] && !ctx?.restore) return;
      state.ran[key] = true;
      try { initFn(ctx || { restore: false }); }
      catch (err) { console.error('HF_INIT_ERROR', key, err); window.hfToast && window.hfToast('Erro ao iniciar a tela. Verifique o console.'); }
    };

    document.addEventListener('DOMContentLoaded', () => run({ restore: false }), { once: true });
    window.addEventListener('pageshow', (ev) => {
      // When restoring from BFCache, avoid duplicated listeners by not re-binding; allow data refresh.
      run({ restore: true, persisted: !!ev.persisted });
    });
  }

  window.hfInitPage = bindOnce;
})();

// Cache / build mismatch protection:
// If the HTML/JS is stale compared to the backend BUILD_ID, force a cache-busted reload ONCE.
async function hfEnsureBuildMatch() {
  try {
    const v = await window.hfApiJson('/api/version', { method: 'GET' });
    const build = v && (v.build || v.BUILD_ID || v.version);
    if (!build) return;

    const last = localStorage.getItem('hf_build_id') || '';
    if (last && last !== build) {
      // Avoid infinite reload loops.
      const loopGuard = sessionStorage.getItem('hf_reload_build') || '';
      if (loopGuard === build) return;
      sessionStorage.setItem('hf_reload_build', build);

      const u = new URL(window.location.href);
      u.searchParams.set('v', build);
      window.location.replace(u.toString());
      return;
    }
    localStorage.setItem('hf_build_id', build);
  } catch (err) {
    // Non-fatal: keep the app usable even if /api/version fails.
    console.warn('HF_BUILD_CHECK_FAIL', err);
  }
}


async function ensureSessionOrRedirect() {
  try {
    const res = await api("/api/me", { method: "GET", cache: "no-store" });

    // Only redirect on explicit auth failure.
    // Do NOT redirect on transient 5xx/4xx errors, otherwise it looks like a "logout".
    if (res.status === 401) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?next=${next}`);
      return null;
    }

    if (!res.ok) {
      // Keep the user on the page and show a clear error.
      // Legacy pages can display it in #msg when present.
      const el = document.getElementById("msg");
      if (el) {
        el.textContent = "Falha ao validar sessão. Tente recarregar a página.";
        el.style.color = "#fca5a5";
      }
      return null;
    }

    return await res.json();
  } catch {
    const el = document.getElementById("msg");
    if (el) {
      el.textContent = "Falha de rede ao validar sessão. Tente recarregar a página.";
      el.style.color = "#fca5a5";
    }
    return null;
  }
}

function bindLogout() {
  const btn = document.getElementById("btnLogout");
  if (!btn) return;

  btn.addEventListener("click", async (ev) => {
    ev.preventDefault();
    // Defensive UX: prevent accidental logouts caused by layout overlaps.
    const ok = window.confirm("Deseja realmente sair do sistema?");
    if (!ok) return;
    try {
      await api("/api/logout", { method: "POST", cache: "no-store", headers: { "x-hf-logout": "1" } });
    } finally {
      window.location.replace("/login.html");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const sp = new URLSearchParams(window.location.search || '');
    if (sp.get('embed') === '1') document.body.classList.add('embed');
  } catch {}

    // Build/cache safety (prevents HTML/JS mismatch after deploy)
  await hfEnsureBuildMatch();

// Client-side auth safety net.
  await ensureSessionOrRedirect();
  try { if (window.hfInitPermissions) await window.hfInitPermissions(); if (window.hfApplyNavVisibility) window.hfApplyNavVisibility(document); if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document); } catch {}

  // Refresh permissions when another module updates them (e.g., Permissões screen).
  window.addEventListener('hf:perms-updated', async () => {
    try {
      if (window.hfInitPermissions) await window.hfInitPermissions();
      if (window.hfApplyNavVisibility) window.hfApplyNavVisibility(document);
      if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document);
    } catch {}
  });
  bindLogout();
});
