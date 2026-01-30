function __hfInit_dashboard(ctx){
/* public/js/dashboard.js
   Dashboard stable: fetch KPIs from /api/dashboard and render without external libs.
*/
(function(){
  const $ = (sel, root=document) => root.querySelector(sel);

  function fmtInt(n){ return new Intl.NumberFormat('pt-BR').format(Number(n||0)); }
  function fmtPct(n){ return `${Number(n||0).toFixed(1)}%`; }
  function fmtMoney(v){
    return new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format(Number(v||0));
  }
  function safeText(x){ return (x==null)?'':String(x); }

  function renderCards(data){
    const cards = data?.cards || {};
    $('#cardLeads').textContent = fmtInt(cards.leads);
    $('#cardClientes').textContent = fmtInt(cards.clientes);
    $('#cardFestas').textContent = fmtInt(cards.festas);
    $('#cardCaixa').textContent = fmtMoney(cards.caixa_saldo);
  }

  function renderKpis(data){
    const k = data?.kpis || {};
    $('#kpiNovosLeads30d').textContent = fmtInt(k.novosLeads30d);
    $('#kpiTaxaConversao').textContent = fmtPct(k.taxaConversao);
    $('#kpiReceitaPrevista').textContent = fmtMoney(k.receitaPrevista);
    $('#kpiReceitaRealizada').textContent = fmtMoney(k.receitaRealizada);
    $('#kpiSaldoCaixa').textContent = fmtMoney(k.saldoCaixa);
  }

  function renderEventosStatus(data){
    const box = $('#statusBars');
    box.innerHTML = '';
    const map = data?.eventosPorStatus || {};
    const entries = Object.entries(map).sort((a,b)=>b[1]-a[1]);
    const max = entries.reduce((m,[,v])=>Math.max(m, Number(v||0)), 0) || 1;

    for (const [status, n] of entries) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = status || '(sem status)';

      const barWrap = document.createElement('div');
      barWrap.className = 'bar-wrap';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.style.width = `${Math.round((Number(n||0)/max)*100)}%`;
      barWrap.appendChild(bar);

      const value = document.createElement('div');
      value.className = 'bar-value';
      value.textContent = fmtInt(n);

      row.appendChild(label);
      row.appendChild(barWrap);
      row.appendChild(value);
      box.appendChild(row);
    }

    if (!entries.length) {
      box.innerHTML = '<div class="muted">Sem dados de eventos ainda.</div>';
    }
  }

  function renderProximas(data){
    const tbody = $('#tblProximasBody');
    tbody.innerHTML = '';
    const rows = data?.proximas || [];
    for (const r of rows) {
      const tr = document.createElement('tr');
      const d = safeText(r.data_evento || '').slice(0,10);
      tr.innerHTML = `
        <td>${safeText(r.cliente_nome || '')}</td>
        <td>${safeText(r.tipo_evento || '')}</td>
        <td>${safeText(d)}</td>
        <td style="text-align:right;">${fmtInt(r.convidados || 0)}</td>
        <td style="text-align:right;">${fmtMoney(r.valor_total || 0)}</td>
        <td>${safeText(r.status || '')}</td>
        <td style="text-align:right;"><a class="btn-mini" href="/app/festa?id=${encodeURIComponent(r.id)}">Abrir</a></td>
      `;
      tbody.appendChild(tr);
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="muted">Sem próximas festas cadastradas.</td></tr>';
    }
  }

  function renderError(msg){
    const el = $('#dashError');
    el.textContent = msg;
    el.style.display = 'block';
  }

  function renderLegacyFixUI(diag) {
    const el = $('#dashLegacy');
    if (!el) return;
    const perfil = String(window.HF_PERMS && window.HF_PERMS.perfil || '').toLowerCase();
    const isAdmin = perfil === 'admin';
    if (!isAdmin) return;

    const d = (diag && diag.diagnostics) ? diag.diagnostics : {};
    const tables = Object.keys(d);
    const withNulls = tables.filter((t) => Number(d[t]?.nulls || 0) > 0);
    if (!withNulls.length) {
      el.style.display = 'none';
      return;
    }

    const rows = withNulls.map((t) => {
      const row = d[t] || {};
      const nulls = Number(row.nulls || 0);
      const distinct = Number(row.distinct || 0);
      const only = row.only == null ? '—' : String(row.only);
      return `<tr><td>${t}</td><td style="text-align:right;">${nulls}</td><td style="text-align:right;">${distinct}</td><td style="text-align:right;">${only}</td></tr>`;
    }).join('');

    el.innerHTML = `
      <div class="card-head">
        <h3>Diagnóstico: dados legados sem empresa_id</h3>
        <span class="pill">admin</span>
      </div>
      <p class="muted" style="margin-top:8px;">
        Encontramos registros com <strong>empresa_id = NULL</strong>. Por segurança (multi-tenant), eles <strong>não aparecem</strong> nas telas/KPIs.
        Se esse ambiente é de <strong>uma única empresa</strong> (ADMIN_EMPRESA_ID=${diag?.targetEmpresaId ?? '—'}), você pode corrigir com o botão abaixo.
      </p>
      <div style="overflow:auto; margin-top:10px;">
        <table class="tbl">
          <thead><tr><th>Tabela</th><th style="text-align:right;">NULLs</th><th style="text-align:right;">Tenants</th><th style="text-align:right;">Only</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <button id="btnBackfillNullEmpresa" class="btn-primary">Corrigir (atribuir ao ADMIN_EMPRESA_ID)</button>
        <span class="pill">ação segura: só executa se não detectar múltiplos tenants</span>
      </div>
    `;
    el.style.display = 'block';

    const btn = $('#btnBackfillNullEmpresa');
    if (btn) {
      btn.addEventListener('click', async () => {
        try {
          btn.disabled = true;
          const res = await window.hfApiJson('/api/admin/backfill-null-empresa', { method: 'POST' });
          const skipped = (res?.results || []).filter((r) => r.skipped);
          if (skipped.length) {
            (window.hfToast || alert)(`Backfill parcial: algumas tabelas foram puladas por segurança (múltiplos tenants).`);
          } else {
            (window.hfToast || alert)('Backfill executado. Recarregando dashboard...');
          }
          location.reload();
        } catch (e) {
          console.error('backfill error', e);
          (window.hfToast || alert)('Falha ao executar backfill. Veja o console.');
          btn.disabled = false;
        }
      });
    }
  }

  async function boot(){
    try {
      // wait permissions to avoid false 'sem permissão'
      if (window.hfPermsReady) await window.hfPermsReady;
      if (window.hfCanRead && !window.hfCanRead('dashboard')) {
        if (window.hfRenderNoPermission) return window.hfRenderNoPermission({ module: 'dashboard' });
        renderError('Sem permissão para acessar o dashboard.');
        return;
      }

      const data = await window.hfApiJson('/api/dashboard', { method:'GET' });
      renderCards(data);
      renderKpis(data);
      renderEventosStatus(data);
      renderProximas(data);

      // Admin-only: detect legacy rows that are hidden by tenant rules.
      try {
        const perfil = String(window.HF_PERMS && window.HF_PERMS.perfil || '').toLowerCase();
        if (perfil === 'admin') {
          const diag = await window.hfApiJson('/api/admin/diag-null-empresa', { method: 'GET' });
          renderLegacyFixUI(diag);
        }
      } catch (e) {
        // Never break dashboard for diag failures.
        console.warn('diag-null-empresa failed', e);
      }
    } catch (err) {
      console.error('dashboard boot error', err);
      renderError('Falha ao carregar dados do dashboard. Recarregue a página.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => { boot(); });
})();

}

if (window.hfInitPage) window.hfInitPage('dashboard', __hfInit_dashboard);
else document.addEventListener('DOMContentLoaded', () => __hfInit_dashboard({ restore:false }), { once:true });
