/*
  public/app.js
  New Dark Dashboard controller.
  Strategy (Option 1): make the dark dashboard a navigation hub that redirects to the existing legacy modules.
  All clicks must either navigate, open a working modal, or be disabled with a tooltip.
*/

const views = {
  dashboard: { title: "Dashboard", hint: "Visão geral do dia e atalhos rápidos." },
  clientes: { title: "Clientes", hint: "Abrir módulo de clientes." },
  eventos: { title: "Festas", hint: "Abrir módulo de festas." },
  financeiro: { title: "Financeiro", hint: "Abrir módulo financeiro." },
  usuarios: { title: "Usuários", hint: "Gerenciar usuários e permissões." },
  leads: { title: "Leads", hint: "Abrir módulo de leads." },
  contratos: { title: "Contratos", hint: "Em desenvolvimento." },
  patrimonio: { title: "Patrimônio", hint: "Em desenvolvimento." },
  relatorios: { title: "Relatórios", hint: "Em desenvolvimento." },
  config: { title: "Configurações", hint: "Marca, permissões e padrões." },
};

// Stable routes to legacy modules (production-ready today).
const ROUTE_MAP = {
  clientes: "/app/clientes.html",
  eventos: "/app/festas.html",
  financeiro: "/app/financeiro.html",
  usuarios: "/app/usuarios.html",
  leads: "/app/leads.html",
};

// Views that are not implemented as legacy modules yet.
const DEV_VIEWS = new Set(["contratos", "patrimonio", "relatorios"]);

function navigateTo(path) {
  window.location.href = path;
}

function setView(key) {
  // buttons
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === key);
  });
  // sections
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
  const el = document.getElementById(`view-${key}`);
  if (el) el.classList.add("is-active");

  // header
  const meta = views[key] || { title: "Sistema", hint: "" };
  const titleEl = document.getElementById("pageTitle");
  const hintEl = document.getElementById("pageHint");
  if (titleEl) titleEl.textContent = meta.title;
  if (hintEl) hintEl.textContent = meta.hint;

  // close sidebar on mobile
  document.querySelector(".sidebar")?.classList.remove("is-open");
}

function markAsDevDisabled(el, tooltip = "Em desenvolvimento") {
  if (!el) return;
  // Support both <button> and <a>
  if (el.tagName === "BUTTON") {
    el.disabled = true;
  } else {
    el.setAttribute("aria-disabled", "true");
    el.addEventListener("click", (e) => e.preventDefault());
  }
  el.title = tooltip;
  el.classList.add("is-disabled");
}

function wireSidebarNavigation() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    const key = btn.dataset.view;

    // Dashboard stays inside the dark shell.
    if (key === "dashboard") {
      btn.addEventListener("click", () => setView("dashboard"));
      return;
    }

    // Legacy modules: redirect.
    if (ROUTE_MAP[key]) {
      btn.addEventListener("click", () => navigateTo(ROUTE_MAP[key]));
      return;
    }

    // Not implemented yet.
    if (DEV_VIEWS.has(key)) {
      markAsDevDisabled(btn, "Em desenvolvimento");
      return;
    }

    // Config view is still inside the shell.
    if (key === "config") {
      btn.addEventListener("click", () => setView("config"));
      return;
    }

    // Fallback: do nothing (but avoid dead click)
    markAsDevDisabled(btn, "Em desenvolvimento");
  });
}

// Mobile menu
function wireMobileMenu() {
  document.getElementById("btnMenu")?.addEventListener("click", () => {
    document.querySelector(".sidebar")?.classList.toggle("is-open");
  });
}

// Modal
const modal = document.getElementById("modal");
const modalSaveBtn = document.getElementById("modalSave");

function openModal(title, hint, bodyHTML, opts = {}) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalHint").textContent = hint || "";
  document.getElementById("modalBody").innerHTML = bodyHTML || "";

  // Save button behavior
  if (modalSaveBtn) {
    const showSave = opts.showSave !== false; // default true
    modalSaveBtn.hidden = !showSave;
    modalSaveBtn.textContent = opts.saveText || "Salvar";
    modalSaveBtn.onclick = null;
    if (typeof opts.onSave === "function") {
      modalSaveBtn.onclick = opts.onSave;
    }
  }

  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  if (modalSaveBtn) {
    modalSaveBtn.hidden = false;
    modalSaveBtn.textContent = "Salvar";
    modalSaveBtn.onclick = null;
  }
}

modal?.addEventListener("click", (e) => {
  if (e.target?.dataset?.close) closeModal();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modal?.classList.contains("is-open")) closeModal();
});

function wireDashboardActions() {
  // Quick action: create a new party -> legacy festas (opens modal there)
  document.querySelectorAll("[data-action='go-eventos']").forEach((btn) => {
    btn.addEventListener("click", () => navigateTo("/app/festas.html?action=create"));
  });

  // Disable demo-only buttons inside dashboard tables/panels
  document.querySelectorAll(".panel-actions .btn").forEach((btn) => {
    const txt = (btn.textContent || "").trim().toLowerCase();
    if (txt === "filtrar" || txt === "exportar") {
      markAsDevDisabled(btn, "Em desenvolvimento");
    }
  });

  // Disable demo "Abrir" buttons in the sample table (no real IDs yet)
  document
    .querySelectorAll("#view-dashboard .table .btn.btn-ghost.btn-sm")
    .forEach((btn) => markAsDevDisabled(btn, "Em desenvolvimento"));
}

function wireQuickAdd() {
  document.getElementById("btnQuickAdd")?.addEventListener("click", () => {
    openModal(
      "Novo",
      "Escolha o que deseja criar.",
      `
      <div class="grid two">
        <button class="btn btn-primary w-full" data-go="/app/clientes.html">+ Cliente</button>
        <button class="btn btn-primary w-full" data-go="/app/festas.html?action=create">+ Festa</button>
        <button class="btn btn-ghost w-full" data-go="/app/financeiro.html">+ Lançamento</button>
        <button class="btn btn-ghost w-full" data-dev="1" title="Em desenvolvimento" disabled>+ Contrato</button>
      </div>
      `,
      { showSave: false }
    );

    document.querySelectorAll("[data-go]").forEach((b) => {
      b.addEventListener("click", () => navigateTo(b.dataset.go));
    });
  });
}

// Accent live (config)
function wireAccent() {
  document.getElementById("applyAccent")?.addEventListener("click", () => {
    const val = document.getElementById("accentInput").value?.trim() || "#d4a84f";
    document.documentElement.style.setProperty("--accent", val);
  });
}

// Basic global search (UI-only)
function wireSearch() {
  document.getElementById("globalSearch")?.addEventListener("input", () => {
    // UI-only: later we'll search in D1.
  });
}

// Initialize
(function init() {
  wireSidebarNavigation();
  wireMobileMenu();
  wireDashboardActions();
  wireQuickAdd();
  wireAccent();
  wireSearch();

  // Keep the default view stable.
  setView("dashboard");
})();


// Build marker (helps verify deployed version)
(async function loadBuildTag(){
  try {
    const el = document.getElementById('buildTag');
    if (!el) return;
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.build) {
      el.textContent = `(${data.build})`;
    }
  } catch (_) {}
})();
