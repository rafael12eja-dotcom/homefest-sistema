function __hfInit_permissoes(ctx){
/* public/js/permissoes.js
   Admin UI to manage perfil permissions (tenant-scoped).
*/
(function () {
  const $ = (id) => document.getElementById(id);

  function show(msg, isErr=false) {
    const el = $('msg');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isErr ? '#fca5a5' : 'rgba(255,255,255,.75)';
  }

  function renderTable(perms) {
    const tbody = $('permTbody');
    tbody.innerHTML = '';
    const modules = Object.keys(perms || {});
    for (const m of modules) {
      const tr = document.createElement('tr');
      const tdM = document.createElement('td');
      tdM.textContent = m;
      tr.appendChild(tdM);

      ['read','create','update','delete'].forEach((a) => {
        const td = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.mod = m;
        cb.dataset.act = a;
        cb.checked = !!(perms[m] && perms[m][a]);
        td.appendChild(cb);
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }
  }


  function setAll(checked=false){
    document.querySelectorAll('#permTbody input[type="checkbox"]').forEach((cb)=>{ cb.checked = !!checked; });
  }

  function applyPreset(kind){
    // Presets are UX helpers only; user still must click "Salvar".
    // Fail-closed: anything not explicitly enabled stays disabled.
    const preset = {
      vendas: {
        dashboard: ['read'],
        leads: ['read','create','update','delete'],
        clientes: ['read','create','update'],
        eventos: ['read','create','update'],
        propostas: ['read','create','update'],
        contratos: ['read','create','update'],
      },
      financeiro: {
        dashboard: ['read'],
        financeiro: ['read','create','update'],
        clientes: ['read'],
        eventos: ['read'],
        leads: ['read'],
        propostas: ['read'],
        contratos: ['read'],
      },
      operacional: {
        dashboard: ['read'],
        eventos: ['read','update'],
        clientes: ['read'],
        leads: ['read'],
        propostas: ['read'],
        contratos: ['read','update'],
      },
    }[kind];

    if (!preset) return;

    // Clear everything first, then set allowed.
    setAll(false);

    document.querySelectorAll('#permTbody input[type="checkbox"]').forEach((cb) => {
      const m = (cb.dataset.mod || '').toLowerCase();
      const a = (cb.dataset.act || '').toLowerCase();
      const allowedActions = preset[m] || [];
      cb.checked = allowedActions.includes(a);
    });

    show(`Preset aplicado: ${kind}. Agora clique em "Salvar" para persistir.`);
    try { if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document); } catch {}
  }

  function collectTable() {
    const perms = {};
    document.querySelectorAll('#permTbody input[type="checkbox"]').forEach((cb) => {
      const m = cb.dataset.mod;
      const a = cb.dataset.act;
      if (!perms[m]) perms[m] = {};
      perms[m][a] = cb.checked ? 1 : 0;
    });
    return perms;
  }

  async function load() {
    const perfil = $('perfilSelect').value;
    show('Carregando...');
    try {
      const data = await window.hfApiJson(`/api/permissoes/perfis?perfil=${encodeURIComponent(perfil)}`, { method: 'GET' });
      renderTable(data.permissoes);
      try { if (window.applyPermissionsToDOM) window.applyPermissionsToDOM(document); } catch {}
      show('Permissões carregadas.');
    } catch (e) {
      show(e && e.message ? e.message : 'Erro ao carregar.', true);
    }
  }

  async function save() {
    const perfil = $('perfilSelect').value;
    const perms = collectTable();
    show('Salvando...');
    try {
      await window.hfApiJson('/api/permissoes/perfis', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perfil, permissoes: perms }),
      });
      show('Permissões salvas.');
    } catch (e) {
      show(e && e.message ? e.message : 'Erro ao salvar.', true);
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    // Safety: only admins should even see this page. Backend also enforces.
    try {
      const me = await window.hfApiJson('/api/me', { method: 'GET' });
      if (!me || !me.perfil || me.perfil !== 'admin') {
        show('Acesso negado. Somente admin.', true);
        document.querySelector('main')?.classList.add('disabled');
        return;
      }
    } catch {}

    // UX: default dropdown to 'admin' (current user) to avoid saving perms on wrong perfil
    try {
      const sel = $('perfilSelect');
      if (sel) {
        const hasAdmin = Array.from(sel.options || []).some(o => (o.value || '').toLowerCase() === 'admin');
        if (hasAdmin) sel.value = 'admin';
      }
    } catch {}


    $('btnLoad').addEventListener('click', (e)=>{ e.preventDefault(); load(); });
    $('btnSave').addEventListener('click', (e)=>{ e.preventDefault(); save(); });

    $('btnPresetVendas')?.addEventListener('click', ()=> applyPreset('vendas'));
    $('btnPresetFinanceiro')?.addEventListener('click', ()=> applyPreset('financeiro'));
    $('btnPresetOperacional')?.addEventListener('click', ()=> applyPreset('operacional'));

    // auto load
    load();
  });
})();
}

if (window.hfInitPage) window.hfInitPage('permissoes', __hfInit_permissoes);
else document.addEventListener('DOMContentLoaded', () => __hfInit_permissoes({ restore:false }), { once:true });
