function __hfInit_financeiro(ctx){
// public/js/financeiro.js
(function () {
  function qs(sel, el) { return (el || document).querySelector(sel); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  function fmtBRL(n) {
    const v = Number(n || 0);
    try { return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    catch { return 'R$ ' + v.toFixed(2); }
  }
  function todayIso() {
    const d = new Date();
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }

  async function safeApiJson(path, options) {
    try { return await window.hfApiJson(path, options); }
    catch (e) { return { __error: true, message: (e && e.message) ? e.message : 'Erro' , status: e && e.status }; }
  }

  
  function notify(msg) {
    try {
      const fn = window.toast || window.hfToast;
      if (typeof fn === 'function') return fn(String(msg || ''));
    } catch {}
    console.log(msg);
  }

  const toast = notify;

  function setBtnLoading(btn, loading, label) {
    if (!btn) return;
    if (loading) {
      btn.dataset._oldText = btn.textContent;
      btn.textContent = label || 'Carregando...';
      btn.disabled = true;
      btn.classList.add('is-loading');
    } else {
      if (btn.dataset._oldText) btn.textContent = btn.dataset._oldText;
      btn.disabled = false;
      btn.classList.remove('is-loading');
    }
  }

function renderShell(root) {
    root.innerHTML = `
      <div class="page-head">
        <div>
          <h1>Financeiro</h1>
          <p class="muted">Contas a receber (A/R), contas a pagar (A/P), custos do evento e margem.</p>
        </div>
        <div class="page-actions">
          <div class="field">
            <label class="label">Evento</label>
            <select id="finEvento" class="select"></select>
          </div>
          <button class="btn-ghost" id="btnRefresh">Atualizar</button>
        </div>
      </div>

      <section class="card fin-card">
        <div class="card-head">
          <h3>Caixa da empresa</h3>
          <span class="pill">saldo</span>
        </div>
        <div class="fin-caixa">
          <div class="fin-caixa-metrics">
            <div class="metric">
              <div class="metric-label">Saldo atual</div>
              <div class="metric-value" id="cxSaldo">—</div>
            </div>
            <div class="metric">
              <div class="metric-label">Entradas</div>
              <div class="metric-value" id="cxEntradas">—</div>
            </div>
            <div class="metric">
              <div class="metric-label">Saídas</div>
              <div class="metric-value" id="cxSaidas">—</div>
            </div>
          </div>

          <div class="fin-caixa-form">
            <div class="grid-3">
              <div class="field">
                <label class="label">Tipo</label>
                <select id="cxTipo" class="select" data-perm="financeiro:create">
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
              </div>
              <div class="field">
                <label class="label">Categoria</label>
                <select id="cxCategoria" class="select" data-perm="financeiro:create">
                  <option value="aporte">Aporte</option>
                  <option value="retirada_socio">Retirada</option>
                  <option value="patrimonio">Patrimônio (compra)</option>
                  <option value="despesa">Despesa</option>
                  <option value="receita">Receita</option>
                  <option value="outros">Outros</option>
                </select>
              </div>
              <div class="field">
                <label class="label">Data</label>
                <input id="cxData" type="date" class="input" data-perm="financeiro:create"/>
              </div>
            </div>

            <div class="grid-3">
              <div class="field">
                <label class="label">Valor</label>
                <input id="cxValor" type="number" step="0.01" class="input" placeholder="0,00" data-perm="financeiro:create"/>
              </div>
              <div class="field">
                <label class="label">Descrição</label>
                <input id="cxDesc" type="text" class="input" placeholder="Ex.: Investimento inicial" data-perm="financeiro:create"/>
              </div>
              <div class="field">
                <label class="label">Método</label>
                <input id="cxMetodo" type="text" class="input" placeholder="pix / dinheiro / transferência" data-perm="financeiro:create"/>
              </div>
            </div>

            <div class="fin-actions">
              <button class="btn-primary btn-sm" id="btnCxAdd" data-perm="financeiro:create">Adicionar ao caixa</button>
            </div>

            <div class="fin-hint muted">
              Dica: registre aqui o <b>investimento inicial</b> (entrada), compras de <b>patrimônio</b> (saída) e <b>retiradas</b>.
            </div>
          </div>

          <div class="fin-caixa-list">
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Tipo</th>
                    <th>Categoria</th>
                    <th>Descrição</th>
                    <th class="t-right">Valor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody id="cxRows">
                  <tr><td colspan="6" class="muted">Carregando…</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section class="card fin-card">
        <div class="card-head">
          <h3>Resumo do evento</h3>
          <span class="pill">visão geral</span>
        </div>
        <div id="finResumo" class="fin-loading">Selecione um evento para ver o resumo.</div>
      </section>

      <div class="grid-2">
        <section class="card fin-card">
          <div class="card-head">
            <h3>Contas a Receber</h3>
            <span class="pill">A/R</span>
          </div>

          <div class="fin-actions">
            <button class="btn-primary btn-sm" id="btnGerar5050" data-perm="financeiro:create">Gerar recebível 50/50</button>
          </div>

          <div id="finAR" class="fin-loading">—</div>
        </section>

        <section class="card fin-card">
          <div class="card-head">
            <h3>Contas a Pagar</h3>
            <span class="pill">A/P</span>
          </div>

          <form id="apForm" class="fin-form" data-perm="financeiro:create">
            <div class="row">
              <div class="field">
                <label class="label">Descrição</label>
                <input class="input" id="apDesc" placeholder="Ex.: Decoração, DJ, equipe..." />
              </div>
              <div class="field">
                <label class="label">Valor</label>
                <input class="input" id="apValor" inputmode="decimal" placeholder="0,00" />
              </div>
            </div>
            <div class="row">
              <div class="field">
                <label class="label">Vencimento</label>
                <input class="input" id="apVenc" type="date" />
              </div>
              <div class="field">
                <label class="label">Categoria</label>
                <input class="input" id="apCat" placeholder="Ex.: Fornecedores" />
              </div>
              <div class="field">
                <label class="label">Fornecedor</label>
                <input class="input" id="apForn" placeholder="Opcional" />
              </div>
              <div class="field">
                <label class="label">&nbsp;</label>
                <button class="btn-primary" type="submit">Adicionar</button>
              </div>
            </div>
          </form>

          <div id="finAP" class="fin-loading">—</div>
        </section>
      </div>

      <section class="card fin-card">
        <div class="card-head">
          <h3>Custos do evento</h3>
          <span class="pill">planejamento</span>
        </div>

        <div class="fin-actions">
          <div class="field">
            <label class="label">Preset</label>
            <select id="presetSelect" class="select" data-perm="financeiro:update">
              <option value="infantil_20">Infantil 20</option>
              <option value="infantil_30">Infantil 30</option>
              <option value="infantil_40">Infantil 40</option>
              <option value="infantil_50">Infantil 50</option>
              <option value="infantil_70">Infantil 70</option>
              <option value="infantil_80">Infantil 80</option>
              <option value="infantil_100">Infantil 100</option>
            </select>
          </div>
          <button class="btn-ghost btn-sm" id="btnImportCustos" data-perm="financeiro:update">Importar preset</button>
          <span class="muted fin-hint">Importação só funciona se o evento ainda não tiver itens.</span>
        </div>

        <div id="finCustos" class="fin-loading">—</div>
      </section>
    `;
  }

  let __lastResumoSig = null;

  function renderResumo(el, r) {
    const sig = JSON.stringify(r || {});
    if (__lastResumoSig === sig) return;
    __lastResumoSig = sig;
    el.innerHTML = `
      <div class="grid-3">
        <div class="panel fin-kpi">
          <div class="kpi-title">Receber</div>
          <div class="kpi-row"><span class="muted">Previsto</span><strong>${fmtBRL(r.receber_previsto)}</strong></div>
          <div class="kpi-row"><span class="muted">Realizado</span><strong>${fmtBRL(r.receber_realizado)}</strong></div>
        </div>
        <div class="panel fin-kpi">
          <div class="kpi-title">Pagar</div>
          <div class="kpi-row"><span class="muted">Previsto</span><strong>${fmtBRL(r.pagar_previsto)}</strong></div>
          <div class="kpi-row"><span class="muted">Realizado</span><strong>${fmtBRL(r.pagar_realizado)}</strong></div>
        </div>
        <div class="panel fin-kpi">
          <div class="kpi-title">Resultado</div>
          <div class="kpi-row"><span class="muted">Custos</span><strong>${fmtBRL(r.custos_planejados)}</strong></div>
          <div class="kpi-row"><span class="muted">Margem (prev.)</span><strong>${fmtBRL(r.margem_prevista)}</strong></div>
          <div class="kpi-row"><span class="muted">Caixa (real)</span><strong>${fmtBRL(r.caixa_real)}</strong></div>
        </div>
      </div>
    `;
  }

  function renderError(el, title, msg) {
    el.innerHTML = `
      <div class="no-permission">
        <h3 style="margin:0 0 6px 0;">${esc(title)}</h3>
        <div class="muted">${esc(msg || 'Erro interno')}</div>
      </div>
    `;
  }

  function renderARTitulos(el, titulos, parcelasMap) {
    if (!titulos.length) {
      el.innerHTML = `<div class="muted">Nenhum recebível cadastrado para este evento.</div>`;
      return;
    }
    const rows = titulos.map(t => {
      const parcels = parcelasMap.get(t.id) || [];
      const total = parcels.reduce((a,p)=>a+Number(p.valor||0),0);
      const pago = parcels.filter(p=>p.status==='paga').reduce((a,p)=>a+Number(p.valor||0),0);
      return `
        <tr>
          <td><strong>${esc(t.descricao || 'Recebível')}</strong><div class="muted">#${t.id}</div></td>
          <td>${fmtBRL(total)}</td>
          <td>${fmtBRL(pago)}</td>
          <td>${esc(t.status || 'aberto')}</td>
        </tr>
        <tr>
          <td colspan="4" style="padding-top:0">
            <div class="table-wrap">
              <table class="fin-table">
                <thead><tr><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody>
                  ${parcels.map(p => `
                    <tr>
                      <td>${esc(p.vencimento || '')}</td>
                      <td>${fmtBRL(p.valor)}</td>
                      <td>${esc(p.status)}</td>
                      <td>
                        ${p.status === 'paga' ? '<span class="muted">—</span>' : `
                        <button class="btn-ghost btn-sm" data-act="pagar-parcela" data-id="${p.id}" data-perm="financeiro:update">Marcar como paga</button>
                        `}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    el.innerHTML = `
      <div class="table-wrap">
        <table class="fin-table">
          <thead><tr><th>Título</th><th>Total</th><th>Pago</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderAP(el, contas) {
    if (!contas.length) {
      el.innerHTML = `<div class="muted">Nenhuma conta a pagar cadastrada para este evento.</div>`;
      return;
    }
    el.innerHTML = `
      <div class="table-wrap">
        <table class="fin-table">
          <thead><tr><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>
            ${contas.map(c => `
              <tr>
                <td><strong>${esc(c.descricao || 'Conta')}</strong><div class="muted">${esc(c.fornecedor || '')} ${c.categoria ? '· ' + esc(c.categoria) : ''}</div></td>
                <td>${esc(c.vencimento || '')}</td>
                <td>${fmtBRL(c.valor)}</td>
                <td>${esc(c.status)}</td>
                <td>
                  ${c.status !== 'paga' ? `<button class="btn-ghost btn-sm" data-act="pagar-ap" data-id="${c.id}" data-perm="financeiro:update">Pagar</button>` : `<span class="muted">—</span>`}
                  <button class="btn-ghost btn-sm" data-act="del-ap" data-id="${c.id}" data-perm="financeiro:delete">Excluir</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderCustos(el, itens, canRead) {
    if (!canRead) {
      el.innerHTML = `<div class="muted">Você não tem permissão para visualizar itens do evento (custos planejados).</div>`;
      return;
    }
    if (!Array.isArray(itens) || !itens.length) {
      el.innerHTML = `<div class="muted">Nenhum item/custo cadastrado neste evento.</div>`;
      return;
    }
    const total = itens.reduce((a,i)=>a+Number(i.valor_total||0),0);
    el.innerHTML = `
      <div class="fin-total">
        <div><strong>Total planejado</strong></div>
        <div class="fin-total-value">${fmtBRL(total)}</div>
      </div>
      <div class="table-wrap">
        <table class="fin-table">
          <thead><tr><th>Item</th><th>Qtd</th><th>Unit</th><th>Total</th></tr></thead>
          <tbody>
            ${itens.map(i=>`
              <tr>
                <td>${esc(i.descricao || '')}</td>
                <td>${esc(i.quantidade || '')}</td>
                <td>${fmtBRL(i.valor_unitario)}</td>
                <td>${fmtBRL(i.valor_total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  
  async function loadCaixa() {
    const resp = await safeApiJson('/api/financeiro/caixa?limit=20');
    if (resp.__error) {
      const rows = qs('#cxRows');
      if (rows) rows.innerHTML = `<tr><td colspan="6" class="muted">${esc(resp.message || 'Erro ao carregar caixa')}</td></tr>`;
      return;
    }
    qs('#cxSaldo') && (qs('#cxSaldo').textContent = fmtBRL(resp.saldo));
    qs('#cxEntradas') && (qs('#cxEntradas').textContent = fmtBRL(resp.entradas));
    qs('#cxSaidas') && (qs('#cxSaidas').textContent = fmtBRL(resp.saidas));

    const tbody = qs('#cxRows');
    if (!tbody) return;
    const rows = (resp.items || []).map(r => {
      const tipo = r.tipo === 'entrada' ? 'Entrada' : 'Saída';
      const badgeCls = r.tipo === 'entrada' ? 'badge-ok' : 'badge-warn';
      return `<tr>
        <td>${esc(r.data_movimento)}</td>
        <td><span class="badge ${badgeCls}">${esc(tipo)}</span></td>
        <td>${esc(r.categoria)}</td>
        <td>${esc(r.descricao || '')}</td>
        <td class="t-right">${fmtBRL(r.valor)}</td>
        <td class="t-right">
          <button class="btn-ghost btn-xs" data-cx-del="${esc(r.id)}" data-perm="financeiro:delete">Excluir</button>
        </td>
      </tr>`;
    }).join('');
    tbody.innerHTML = rows || `<tr><td colspan="6" class="muted">Nenhum lançamento no caixa.</td></tr>`;
    if (window.applyPermissionsToDOM) window.applyPermissionsToDOM();
  }

  function applyCaixaPayload(resp) {
    if (!resp || typeof resp !== 'object') return false;
    if (resp.saldo === undefined || resp.entradas === undefined || resp.saidas === undefined) return false;

    qs('#cxSaldo') && (qs('#cxSaldo').textContent = fmtBRL(resp.saldo));
    qs('#cxEntradas') && (qs('#cxEntradas').textContent = fmtBRL(resp.entradas));
    qs('#cxSaidas') && (qs('#cxSaidas').textContent = fmtBRL(resp.saidas));

    const tbody = qs('#cxRows');
    if (!tbody) return true;
    const rows = (resp.items || []).map(r => {
      const tipo = r.tipo === 'entrada' ? 'Entrada' : 'Saída';
      const badgeCls = r.tipo === 'entrada' ? 'badge-ok' : 'badge-warn';
      return `<tr>
        <td>${esc(r.data_movimento)}</td>
        <td><span class="badge ${badgeCls}">${esc(tipo)}</span></td>
        <td>${esc(r.categoria)}</td>
        <td>${esc(r.descricao || '')}</td>
        <td class="t-right">${fmtBRL(r.valor)}</td>
        <td class="t-right">
          <button class="btn-ghost btn-xs" data-cx-del="${esc(r.id)}" data-perm="financeiro:delete">Excluir</button>
        </td>
      </tr>`;
    }).join('');
    tbody.innerHTML = rows || `<tr><td colspan="6" class="muted">Nenhum lançamento no caixa.</td></tr>`;
    if (window.applyPermissionsToDOM) window.applyPermissionsToDOM();
    return true;
  }

  async function addCaixaFromForm() {
    const tipo = qs('#cxTipo')?.value || 'entrada';
    const categoria = qs('#cxCategoria')?.value || 'outros';
    const data = qs('#cxData')?.value || null;
    const valor = Number(qs('#cxValor')?.value || 0);
    const descricao = (qs('#cxDesc')?.value || '').trim();
    const metodo = (qs('#cxMetodo')?.value || '').trim();

    if (!(valor > 0)) return toast('Informe um valor maior que zero.');
    const payload = { tipo, categoria, valor, data_movimento: data, descricao, metodo };
    const resp = await safeApiJson('/api/financeiro/caixa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (resp.__error) return toast(resp.message || 'Erro ao adicionar lançamento');

    // Reset fields lightly
    qs('#cxValor') && (qs('#cxValor').value = '');
    qs('#cxDesc') && (qs('#cxDesc').value = '');
    qs('#cxMetodo') && (qs('#cxMetodo').value = '');
    toast('Lançamento adicionado.');
    // Prefer the server's summary returned in the same request (avoids read-after-write lag).
    if (!applyCaixaPayload(resp)) {
      await loadCaixa();
    }
  }

async function main() {
    const root = qs('#financeiroRoot');
    if (!root) return;

    // Ensure permissions are loaded before gating UI (avoids race with defer scripts)
    try { if (window.hfPermsReady) await window.hfPermsReady; } catch {}

    // Gate by permission
    if (window.hfCanRead && !window.hfCanRead('financeiro')) {
      root.innerHTML = '';
      if (window.hfRenderNoPermission) {
        window.hfRenderNoPermission({
          module: 'financeiro',
          container: root,
          title: 'Sem permissão',
          description: 'Você não tem permissão para acessar o Financeiro.'
        });
      } else {
        root.innerHTML = '<div class="muted">Você não tem permissão para acessar o Financeiro.</div>';
      }
      return;
    }

    renderShell(root);

    // Caixa
    const cxData = qs('#cxData');
    if (cxData && !cxData.value) cxData.value = (new Date()).toISOString().slice(0,10);
    const btnCxAdd = qs('#btnCxAdd');
    if (btnCxAdd) btnCxAdd.addEventListener('click', addCaixaFromForm);
    root.addEventListener('click', async (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest('[data-cx-del]') : null;
      if (!btn) return;
      const id = btn.getAttribute('data-cx-del');
      if (!id) return;
      if (!confirm('Excluir este lançamento do caixa?')) return;
      const resp = await safeApiJson('/api/financeiro/caixa/' + encodeURIComponent(id), { method: 'DELETE' });
      if (resp.__error) return toast(resp.message || 'Erro ao excluir');
      toast('Excluído.');
      if (!applyCaixaPayload(resp)) {
        await loadCaixa();
      }
    });

    const sel = qs('#finEvento');
    const btnRefresh = qs('#btnRefresh');
    const resumoEl = qs('#finResumo');
    const arEl = qs('#finAR');
    const apEl = qs('#finAP');
    const custosEl = qs('#finCustos');

    const apForm = qs('#apForm');
    const apDesc = qs('#apDesc');
    const apValor = qs('#apValor');
    const apVenc = qs('#apVenc');
    const apCat = qs('#apCat');
    const apForn = qs('#apForn');

    const btnGerar5050 = qs('#btnGerar5050');
    const presetSel = qs('#presetSelect');
    const btnImportCustos = qs('#btnImportCustos');

    apVenc.value = todayIso();

    // Load events
    resumoEl.textContent = 'Carregando eventos...';
    const eventos = await safeApiJson('/api/eventos');
    if (eventos.__error) {
      renderError(resumoEl, 'Erro ao carregar eventos', eventos.message);
      return;
    }
    const list = Array.isArray(eventos) ? eventos : [];
    sel.innerHTML = `<option value="">Selecione...</option>` + list.map(e => {
      const label = `${(e.data_evento || '').slice(0,10)} · ${e.cliente_nome || 'Cliente'} · ${e.tipo_evento || 'Evento'} (#${e.id})`;
      return `<option value="${e.id}">${esc(label)}</option>`;
    }).join('');

    const last = localStorage.getItem('hf_fin_evento_id');
    if (last && list.some(e => String(e.id) === String(last))) sel.value = last;

    async function refresh() {
      await loadCaixa();
      const eventoId = sel.value;
      if (!eventoId) {
        resumoEl.innerHTML = `<div class="muted">Selecione um evento.</div>`;
        arEl.innerHTML = '—';
        apEl.innerHTML = '—';
        custosEl.innerHTML = '—';
        return;
      }
      localStorage.setItem('hf_fin_evento_id', eventoId);

      resumoEl.textContent = 'Carregando resumo...';
      arEl.textContent = 'Carregando A/R...';
      apEl.textContent = 'Carregando A/P...';
      custosEl.textContent = 'Carregando custos...';

      const [resumo, titulos, ap, custos] = await Promise.all([
        safeApiJson('/api/financeiro/resumo?evento_id=' + encodeURIComponent(eventoId)),
        safeApiJson('/api/financeiro/ar?evento_id=' + encodeURIComponent(eventoId)),
        safeApiJson('/api/financeiro/ap?evento_id=' + encodeURIComponent(eventoId)),
        // custos depende de permissão de eventos; se não tiver, não quebra a tela
        (async () => {
          if (window.hasPerm && !hasPerm('eventos', 'read')) return { __skip: true };
          return await safeApiJson('/api/eventos-itens?evento_id=' + encodeURIComponent(eventoId));
        })()
      ]);

      if (resumo.__error) renderError(resumoEl, 'Erro no resumo', resumo.message);
      else renderResumo(resumoEl, resumo);

      // A/R
      if (titulos.__error) {
        renderError(arEl, 'Erro ao carregar A/R', titulos.message);
      } else {
        const tlist = Array.isArray(titulos) ? titulos : [];
        const parcelasMap = new Map();
        // carregar parcelas por título
        for (const t of tlist) {
          const parc = await safeApiJson('/api/financeiro/ar/parcelas?titulo_id=' + encodeURIComponent(t.id));
          if (!parc.__error && Array.isArray(parc)) parcelasMap.set(t.id, parc);
          else parcelasMap.set(t.id, []);
        }
        renderARTitulos(arEl, tlist, parcelasMap);
      }

      // A/P
      if (ap.__error) renderError(apEl, 'Erro ao carregar A/P', ap.message);
      else renderAP(apEl, Array.isArray(ap) ? ap : []);

      // Custos
      if (custos.__skip) {
        renderCustos(custosEl, [], false);
      } else if (custos.__error) {
        // se for 403, já tem toast do apiJson; aqui só não quebra
        renderCustos(custosEl, [], true);
      } else {
        renderCustos(custosEl, Array.isArray(custos) ? custos : [], true);
      }

      if (window.applyPermissionsToDOM) applyPermissionsToDOM();
    }

    if (btnRefresh) btnRefresh.addEventListener('click', refresh);
    if (sel) sel.addEventListener('change', refresh);

    if (btnGerar5050) btnGerar5050.addEventListener('click', async () => {
      const eventoId = sel.value;
      if (!eventoId) return toast('Selecione um evento');
      setBtnLoading(btnGerar5050, true, 'Gerando…');
      try {
        const resp = await safeApiJson('/api/financeiro/ar/gerar-padrao', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ evento_id: Number(eventoId), padrao: '50_50' })
        });
        if (resp.__error) return toast(resp.message || 'Erro ao gerar recebível');
        toast('Recebível gerado com sucesso.');
        await refresh();
      } finally {
        setBtnLoading(btnGerar5050, false);
      }
    });
      if (resp.__error) return toast(resp.message || 'Erro ao gerar recebível');
      toast('Recebível gerado com sucesso.');
      refresh();
    });

    root.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.classList.contains('is-loading')) return;

      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      const eventoId = sel && sel.value ? sel.value : '';
      if (!eventoId) return;

      setBtnLoading(btn, true, 'Aguarde…');
      try {
        if (act === 'pagar-parcela') {
          const resp = await safeApiJson('/api/financeiro/ar/parcela/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'paga', pago_em: todayIso(), forma_pagamento: 'pix' })
          });
          if (resp.__error) return toast(resp.message || 'Erro ao atualizar parcela');
          toast('Parcela marcada como paga.');
          return await refresh();
        }

        if (act === 'pagar-ap') {
          const resp = await safeApiJson('/api/financeiro/ap/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'paga', pago_em: todayIso(), forma_pagamento: 'pix' })
          });
          if (resp.__error) return toast(resp.message || 'Erro ao pagar conta');
          toast('Conta marcada como paga.');
          return await refresh();
        }

        if (act === 'del-ap') {
          if (!confirm('Excluir esta conta a pagar?')) return;
          const resp = await safeApiJson('/api/financeiro/ap/' + encodeURIComponent(id), { method: 'DELETE' });
          if (resp.__error) return toast(resp.message || 'Erro ao excluir');
          toast('Conta excluída.');
          return await refresh();
        }
      } finally {
        setBtnLoading(btn, false);
      }
    });


    if (apForm) apForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const eventoId = sel.value;
      if (!eventoId) return toast('Selecione um evento');
      const valor = Number(String(apValor.value || '').replace(/\./g,'').replace(',','.'));
      if (!apDesc.value.trim()) return toast('Informe uma descrição');
      if (!valor || valor <= 0) return toast('Informe um valor válido');
      const venc = apVenc.value || todayIso();

      const resp = await safeApiJson('/api/financeiro/ap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evento_id: Number(eventoId),
          descricao: apDesc.value.trim(),
          valor,
          vencimento: venc,
          categoria: apCat.value.trim() || null,
          fornecedor: apForn.value.trim() || null
        })
      });
      if (resp.__error) return toast(resp.message || 'Erro ao criar conta');
      apDesc.value = '';
      apValor.value = '';
      apCat.value = '';
      apForn.value = '';
      toast('Conta a pagar criada.');
      refresh();
    });

    if (btnImportCustos) btnImportCustos.addEventListener('click', async () => {
      const eventoId = sel.value;
      if (!eventoId) return toast('Selecione um evento');
      const preset = (presetSel && presetSel.value) ? presetSel.value : 'infantil_20';
      const resp = await safeApiJson('/api/financeiro/custos/preset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ evento_id: Number(eventoId), preset })
      });
      if (resp.__error) return toast(resp.message || 'Erro ao importar preset');
      toast('Preset importado.');
      refresh();
    });

    // Initial render
    await refresh();
  }

  window.addEventListener('DOMContentLoaded', () => { main().catch(() => {}); });
})();

}

if (window.hfInitPage) window.hfInitPage('financeiro', __hfInit_financeiro);
else document.addEventListener('DOMContentLoaded', () => __hfInit_financeiro({ restore:false }), { once:true });
