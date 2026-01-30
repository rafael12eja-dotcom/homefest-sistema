/*
  public/app.js
  Home Fest CRM / ERP — Shell SPA Router (no page reload)
  - Keeps ONE sidebar + ONE permission state
  - Loads legacy modules inside the shell via iframe (?embed=1)
  - Direct URL access: /app/<view> loads index.html (worker rewrite) and router restores view
*/

const views = {
  dashboard: { title: "Dashboard", hint: "Visão geral do dia e atalhos rápidos." },
  clientes: { title: "Clientes", hint: "Base de clientes e histórico." },
  eventos: { title: "Festas", hint: "Agenda, eventos e itens." },
  financeiro: { title: "Financeiro", hint: "Caixa, contas a receber/pagar e custos." },
  leads: { title: "Leads", hint: "Captação e funil." },
  usuarios: { title: "Usuários", hint: "Usuários e segurança." },
  config: { title: "Configurações", hint: "Permissões (RBAC) e padrões." },
  contratos: { title: "Contratos", hint: "Em desenvolvimento." },
  patrimonio: { title: "Patrimônio", hint: "Em desenvolvimento." },
  relatorios: { title: "Relatórios", hint: "Em desenvolvimento." },
};

const LEGACY_IFRAME_SRC = {
  clientes: "/app/clientes.html?embed=1",
  eventos: "/app/festas.html?embed=1",
  financeiro: "/app/financeiro.html?embed=1",
  leads: "/app/leads.html?embed=1",
  usuarios: "/app/usuarios.html?embed=1",
  config: "/app/permissoes.html?embed=1",
};

const DEV_VIEWS = new Set(["contratos", "patrimonio", "relatorios"]);

function normalizeView(v) {
  v = String(v || "").trim().toLowerCase();
  if (!v) return "dashboard";
  if (v === "permissoes") return "config";
  if (v === "festas") return "eventos";
  return views[v] ? v : "dashboard";
}

function viewFromPathname(pathname) {
  // Accept:
  //  - /            -> dashboard
  //  - /app         -> dashboard
  //  - /app/        -> dashboard
  //  - /app/<view>  -> view
  const p = String(pathname || "/");
  if (p === "/" || p === "/index.html") return "dashboard";
  if (p === "/app" || p === "/app/") return "dashboard";
  if (p.startsWith("/app/")) {
    const seg = p.slice("/app/".length).split("/")[0];
    return normalizeView(seg);
  }
  return "dashboard";
}

function pathForView(view) {
  // Keep the URL stable for deep links and refresh safety.
  if (view === "dashboard") return "/app";
  return `/app/${view}`;
}

function setHeader(viewKey) {
  const meta = views[viewKey] || { title: "Sistema", hint: "" };
  const titleEl = document.getElementById("pageTitle");
  const hintEl = document.getElementById("pageHint");
  if (titleEl) titleEl.textContent = meta.title;
  if (hintEl) hintEl.textContent = meta.hint || "";
  document.title = `${meta.title} • Home Fest & Eventos`;
}

function ensureIframe(viewKey, viewEl) {
  const src = LEGACY_IFRAME_SRC[viewKey];
  if (!src) return;

  // First time: replace placeholder UI by an iframe container.
  if (!viewEl.dataset.embedded) {
    viewEl.innerHTML = `
      <div class="embed-wrap">
        <iframe class="embed-frame" title="${views[viewKey]?.title || viewKey}" loading="eager"></iframe>
      </div>
    `;
    viewEl.dataset.embedded = "1";
  }

  const iframe = viewEl.querySelector("iframe.embed-frame");
  if (!iframe) return;

  // Avoid resetting iframe if already on the same src (keeps scroll/form state).
  if (iframe.getAttribute("src") !== src) {
    iframe.setAttribute("src", src);
  }
}

function showNoPermission() {
  // Used only if the shell can't load permissions; backend remains source of truth.
  const root = document.getElementById("content");
  if (!root) return;
  root.innerHTML = `
    <section class="view is-active" id="view-noperm">
      <div class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">Sem permissão</div>
            <div class="muted tiny">Você não tem permissão para acessar este módulo.</div>
          </div>
        </div>
        <div class="panel-body">
          <button class="btn" id="btnGoDash">Voltar ao Dashboard</button>
        </div>
      </div>
    </section>
  `;
  const btn = document.getElementById("btnGoDash");
  if (btn) btn.addEventListener("click", () => navigate("dashboard"));
}

function setView(viewKey, { push = true } = {}) {
  viewKey = normalizeView(viewKey);

  // Sidebar active state
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === viewKey);
  });

  // Sections active state
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  const viewEl = document.getElementById(`view-${viewKey}`);
  if (viewEl) {
    viewEl.classList.add("is-active");
    if (LEGACY_IFRAME_SRC[viewKey]) ensureIframe(viewKey, viewEl);
  }

  setHeader(viewKey);

  if (push) {
    const nextPath = pathForView(viewKey);
    if (window.location.pathname !== nextPath) {
      history.pushState({ view: viewKey }, "", nextPath);
    }
  }

  // Apply RBAC visibility after each navigation (shell-level)
  try { if (window.hfApplyNavVisibility) window.hfApplyNavVisibility(document); } catch {}
}

function navigate(viewKey) {
  setView(viewKey, { push: true });
}

function bindNav() {
  document.querySelectorAll(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const v = btn.dataset.view;
      if (DEV_VIEWS.has(v)) {
        // Keep UX consistent: show the in-shell placeholder view instead of redirect.
        setView(v, { push: true });
        return;
      }
      navigate(v);
    });
  });
}

async function init() {
  // Permissions: load once and apply to sidebar buttons
  try {
    if (window.hfInitPermissions) await window.hfInitPermissions();
    if (window.hfApplyNavVisibility) window.hfApplyNavVisibility(document);
  } catch {}

  bindNav();

  // Restore view from URL on first load
  const initial = viewFromPathname(window.location.pathname);
  setView(initial, { push: false });

  // Back/forward support
  window.addEventListener("popstate", () => {
    const v = viewFromPathname(window.location.pathname);
    setView(v, { push: false });
  });
}

document.addEventListener("DOMContentLoaded", init);
