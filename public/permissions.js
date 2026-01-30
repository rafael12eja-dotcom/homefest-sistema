/* public/permissions.js
   RBAC UX helper (client-side only; backend remains source of truth).

   Exposes:
     - window.HF_PERMS (loaded from /api/permissoes/me)
     - window.hfPermsReady (Promise that resolves after permissions are loaded)
     - window.hfCan(modulo, acao)
     - window.hfCanRead(modulo)
     - window.hfApplyNavVisibility(rootEl?)
     - window.applyPermissionsToDOM(rootEl?)
*/

(function () {
  function norm(s) { return String(s || '').trim().toLowerCase(); }

  async function fetchPerms() {
    const res = await fetch('/api/permissoes/me', { method: 'GET', credentials: 'include', cache: 'no-store', headers: { 'Accept': 'application/json' } });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    try {
      const data = await res.json();
      return (data && data.ok && data.permissoes) ? data : null;
    } catch {
      return null;
    }
  }

  // Shared promise so modules can await permissions before gating UI.
  // Avoids race conditions with defer scripts (module code runs before DOMContentLoaded).
  if (!window.hfPermsReady) {
    window.hfPermsReady = (async () => {
      const data = await fetchPerms();
      if (data) window.HF_PERMS = data;
      return window.HF_PERMS || null;
    })();
  }

  window.hfCan = function (modulo, acao) {
    const perms = window.HF_PERMS && window.HF_PERMS.permissoes ? window.HF_PERMS.permissoes : null;
    if (!perms) return false;
    const m = norm(modulo);
    const a = norm(acao);
    const list = perms[m];
    if (!Array.isArray(list)) return false;
    return list.includes(a);
  };

  window.hfCanRead = function (modulo) { return window.hfCan(modulo, 'read'); };

  window.hfApplyNavVisibility = function (root) {
    const el = root || document;
    const perfil = norm(window.HF_PERMS && window.HF_PERMS.perfil);
    const isAdmin = perfil === 'admin';

    // Legacy sidebar anchors use href; Dashboard uses buttons with data-view.
    // Hide menu entries if user lacks READ for the corresponding module.
    const rules = [
      { sel: 'a.nav-item[href*="/app/leads"]', mod: 'leads' },
      { sel: 'a.nav-item[href*="/app/clientes"]', mod: 'clientes' },
      { sel: 'a.nav-item[href*="/app/festas"]', mod: 'eventos' },
      { sel: 'a.nav-item[href*="/app/financeiro"]', mod: 'financeiro' },
      { sel: 'a.nav-item[href*="/app/usuarios"]', mod: 'usuarios' },
      { sel: 'a.nav-item[href*="/app/permissoes"]', mod: 'usuarios', adminOnly: true },
    ];

    for (const r of rules) {
      el.querySelectorAll(r.sel).forEach((node) => {
        const allowed = window.hfCanRead(r.mod) && (!r.adminOnly || isAdmin);
        node.style.display = allowed ? '' : 'none';
      });
    }

    // Dashboard nav buttons
    const btnRules = [
      { view: 'leads', mod: 'leads' },
      { view: 'clientes', mod: 'clientes' },
      { view: 'eventos', mod: 'eventos' },
      { view: 'financeiro', mod: 'financeiro' },
      { view: 'usuarios', mod: 'usuarios', adminOnly: true },
      { view: 'config', mod: 'usuarios', adminOnly: true },
    ];
    btnRules.forEach((r) => {
      el.querySelectorAll(`.nav-item[data-view="${r.view}"]`).forEach((btn) => {
        const allowed = window.hfCanRead(r.mod) && (!r.adminOnly || isAdmin);
        btn.style.display = allowed ? '' : 'none';
      });
    });
  };


  // Alias used by newer modules (per spec)
  window.hasPerm = window.hfCan;

  function isSubmitButton(node) {
    if (!node) return false;
    const tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (tag === 'button') return (node.type || '').toLowerCase() === 'submit';
    if (tag === 'input') return (node.type || '').toLowerCase() === 'submit';
    return false;
  }

  function disableNode(node, reason) {
    const r = reason || 'Sem permissão';
    try {
      node.setAttribute('aria-disabled', 'true');
      if (node.tagName && (node.tagName.toLowerCase() === 'button' || node.tagName.toLowerCase() === 'input')) {
        node.disabled = true;
      }
      // Tooltips: use title. Do not overwrite a meaningful title unless empty.
      if (!node.getAttribute('title')) node.setAttribute('title', r);
      node.classList && node.classList.add('is-disabled');
    } catch {}
  }

  function hideNode(node) {
    try {
      node.style.display = 'none';
      node.setAttribute('aria-hidden', 'true');
    } catch {}
  }

  window.applyPermissionsToDOM = function (root) {
    const el = root || document;
    const perfil = norm(window.HF_PERMS && window.HF_PERMS.perfil);
    const isAdmin = perfil === 'admin';

    el.querySelectorAll('[data-perm]').forEach((node) => {
      const raw = node.getAttribute('data-perm');
      const parts = String(raw || '').split(':');
      if (parts.length !== 2) return;
      const mod = norm(parts[0]);
      const act = norm(parts[1]);

      const allowed = isAdmin || window.hfCan(mod, act);
      if (allowed) {
        // Restore basic affordances if previously processed.
        try {
          node.style.display = '';
          node.removeAttribute('aria-hidden');
          node.removeAttribute('aria-disabled');
          if (node.tagName && (node.tagName.toLowerCase() === 'button' || node.tagName.toLowerCase() === 'input')) {
            node.disabled = false;
          }
          node.classList && node.classList.remove('is-disabled');
        } catch {}
        return;
      }

      // Strategy:
      // - Links/menus: hide
      // - Submit buttons: disable + tooltip
      // - Other buttons/inputs: disable (prefer) so layout stays stable
      // - Other elements: hide
      const tag = node.tagName ? node.tagName.toLowerCase() : '';
      const isLinkLike = tag === 'a' || node.classList?.contains('nav-item') || node.getAttribute('role') === 'menuitem';
      if (isLinkLike) return hideNode(node);

      if (isSubmitButton(node)) return disableNode(node, 'Sem permissão');

      if (tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea') {
        return disableNode(node, 'Sem permissão');
      }

      return hideNode(node);
    });
  };

  window.hfRenderNoPermission = function (opts) {
    const module = norm(opts && opts.modulo ? opts.modulo : (opts && opts.module ? opts.module : ''));
    const container = (opts && opts.container) ? opts.container : document.querySelector('main');
    if (!container) return;

    const title = (opts && opts.title) ? opts.title : 'Sem permissão';
    const desc = (opts && opts.description) ? opts.description :
      'Você não tem permissão para acessar este módulo. Se achar que isso é um erro, fale com o administrador da sua empresa.';

    container.innerHTML = `
      <div class="card no-permission">
        <div class="card-head">
          <h3>${title}</h3>
          <span class="pill">RBAC</span>
        </div>
        <p class="muted" style="margin-top:8px;">${desc}</p>
        <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap;">
          <a class="btn-secondary" href="/">Voltar ao Dashboard</a>
          ${module ? `<span class="pill">módulo: ${module}</span>` : ''}
        </div>
      </div>
    `;
  };

  window.hfInitPermissions = async function () {
    try { return await window.hfPermsReady; } catch { return null; }
  };

  // AUTO INIT: ensure permissions are loaded on every page (shell or legacy) before any UI gating.
  // Idempotent: safe to call multiple times.
  async function autoInit() {
    try {
      if (window.hfPermsReady) await window.hfPermsReady;
      if (window.hfApplyNavVisibility) window.hfApplyNavVisibility(document);
      if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document);
    } catch {}
  }

  // Kick off permission load ASAP (no DOM needed)
  autoInit();

  // Apply DOM changes once document is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  }

  // Listen for permission updates (e.g., after saving presets) and refresh locally.
  window.addEventListener('hf:perms-updated', autoInit);

})();
