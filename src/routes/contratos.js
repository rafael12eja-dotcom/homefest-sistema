import { json, ok, fail, getAuth, requireTenant, safeJsonBody } from '../utils/api.js';
import { requirePermission } from '../utils/rbac.js';
import { logAudit } from '../utils/audit.js';

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function sha256Hex(input) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(input || '')));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes) {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  const b64 = btoa(str);
  return b64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function makeToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function money(v) {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function snapshotDefaultsFromProposta(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const termos = p.termos && typeof p.termos === 'object' ? p.termos : {};
  return {
    schema: 'hf_contrato_v1',
    origem: {
      tipo: 'proposta',
      proposta_id: p?.id || null,
      proposta_versao: p?.versao || null,
    },
    titulo: p.titulo || 'Contrato de Prestação de Serviços',
    items: Array.isArray(p.items) ? p.items : [],
    desconto: Number(p.desconto || 0),
    validade: p.validade || '',
    condicoes: p.condicoes || '',
    observacoes: p.observacoes || '',
    termos: {
      // Operational/commercial defaults (can be overridden per contract)
      convidado_excedente_valor: Number(termos.convidado_excedente_valor || 0),
      excedentes_percentual_cortesia: Number(termos.excedentes_percentual_cortesia || 0),
      idade_pagante_a_partir: Number(termos.idade_pagante_a_partir || 0),
      duracao_horas: Number(termos.duracao_horas || 0),
      tolerancia_min: Number(termos.tolerancia_min || 0),
      hora_extra_valor: Number(termos.hora_extra_valor || 0),
      pagamento: {
        entrada_percentual: Number(termos?.pagamento?.entrada_percentual || 0),
        saldo_dias_antes_evento: Number(termos?.pagamento?.saldo_dias_antes_evento || 0),
      },
      // Legal notes (kept generic; full text can evolve)
      quebras_pagamento_imediato: true,
    },
  };
}

function calcTotals(items, desconto) {
  const rows = Array.isArray(items) ? items : [];
  const subtotal = rows.reduce((acc, it) => {
    const q = Number(it.qtd || 0);
    const u = Number(it.unit || 0);
    return acc + (q * u);
  }, 0);
  const d = Number(desconto || 0);
  const total = Math.max(0, subtotal - d);
  return { subtotal, desconto: d, total };
}

async function getEventoTenant(env, eventoId, empresaId) {
  return env.DB.prepare('SELECT id, empresa_id, cliente_id, tipo_evento, data_evento, contrato_numero, convidados, forma_pagamento, valor_total FROM eventos WHERE id=? AND empresa_id=? AND ativo=1')
    .bind(eventoId, empresaId)
    .first();
}

async function getClienteTenant(env, clienteId, empresaId) {
  return env.DB.prepare('SELECT id, nome, cpf, cnpj, telefone, email, endereco FROM clientes WHERE id=? AND empresa_id=? AND ativo=1')
    .bind(clienteId, empresaId)
    .first();
}

async function getContratoHeader(env, contratoId, empresaId) {
  return env.DB.prepare('SELECT * FROM contratos WHERE id=? AND empresa_id=?')
    .bind(contratoId, empresaId)
    .first();
}

async function getContratoVersao(env, versaoId, empresaId) {
  return env.DB.prepare('SELECT * FROM contrato_versoes WHERE id=? AND empresa_id=?')
    .bind(versaoId, empresaId)
    .first();
}

async function renderContratoHtml(env, empresaId, contrato, versao) {
  let snap = {};
  try { snap = JSON.parse(versao.snapshot_json || '{}'); } catch { snap = {}; }

  const ev = contrato.evento_id ? await env.DB.prepare('SELECT * FROM eventos WHERE id=? AND empresa_id=? AND ativo=1').bind(contrato.evento_id, empresaId).first() : null;
  const cli = (contrato.cliente_id && contrato.cliente_id > 0)
    ? await env.DB.prepare('SELECT * FROM clientes WHERE id=? AND empresa_id=? AND ativo=1').bind(contrato.cliente_id, empresaId).first()
    : null;

  const items = Array.isArray(snap.items) ? snap.items : [];
  const totals = calcTotals(items, snap.desconto);

  const titulo = escapeHtml(snap.titulo || 'Contrato de Prestação de Serviços');
  const clienteNome = escapeHtml(cli?.nome || '—');
  const eventoTipo = escapeHtml(ev?.tipo_evento || '—');
  const eventoData = escapeHtml(ev?.data_evento || '—');
  const contratoNum = escapeHtml(ev?.contrato_numero || ev?.id || '—');
  const convidados = escapeHtml(ev?.convidados ?? '—');
  const forma = escapeHtml(ev?.forma_pagamento || '—');

  const termos = (snap.termos && typeof snap.termos === 'object') ? snap.termos : {};

  const rowsHtml = items.map((it, idx) => {
    const desc = escapeHtml(it.desc || '');
    const qtd = Number(it.qtd || 0);
    const unit = Number(it.unit || 0);
    const total = qtd * unit;
    return `
      <tr>
        <td style="width:44px;">${idx + 1}</td>
        <td>${desc}</td>
        <td style="width:90px; text-align:right;">${qtd}</td>
        <td style="width:140px; text-align:right;">${money(unit)}</td>
        <td style="width:160px; text-align:right; font-weight:700;">${money(total)}</td>
      </tr>
    `;
  }).join('');

  const versaoNum = Number(versao.numero_versao || 1);
  const criadoEm = escapeHtml(versao.criado_em || '');

  const termosHtml = `
    <div style="margin-top:18px;">
      <h3 style="margin:0 0 8px 0; font-size:16px;">Cláusulas principais (resumo)</h3>
      <ul style="margin:0; padding-left:18px; line-height:1.45;">
        <li>Convidado excedente: <strong>${money(termos.convidado_excedente_valor || 0)}</strong> por pessoa (com cortesia até <strong>${Number(termos.excedentes_percentual_cortesia || 0)}%</strong>).</li>
        <li>Crianças pagantes a partir de <strong>${Number(termos.idade_pagante_a_partir || 0)} anos</strong>.</li>
        <li>Duração: <strong>${Number(termos.duracao_horas || 0)}h</strong> + tolerância de <strong>${Number(termos.tolerancia_min || 0)} min</strong>.</li>
        <li>Hora extra: <strong>${money(termos.hora_extra_valor || 0)}</strong> por hora ou fração.</li>
        <li>Pagamento: <strong>${Number(termos?.pagamento?.entrada_percentual || 0)}%</strong> de entrada e saldo até <strong>${Number(termos?.pagamento?.saldo_dias_antes_evento || 0)} dias</strong> antes do evento.</li>
        <li>Quebras/danos: apuração ao final do evento e pagamento imediato.</li>
      </ul>
    </div>
  `;

  const doc = `<!doctype html>
  <html lang="pt-br">
  <head>
    <meta charset="utf-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${titulo} • ${clienteNome}</title>
    <style>
      *{ box-sizing:border-box; }
      body{ margin:0; font: 500 14px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial; background:#fff; color:#0b1220; }
      .page{ max-width: 980px; margin: 28px auto; padding: 0 18px; }
      .top{ display:flex; justify-content:space-between; gap:18px; align-items:flex-start; border:1px solid #e5e7eb; border-radius:16px; padding:18px; }
      .brand{ font-weight: 900; letter-spacing:.2px; font-size: 18px; }
      .tag{ display:inline-block; padding: 6px 10px; border-radius:999px; border:1px solid #e5e7eb; font-weight:800; }
      h1{ margin: 14px 0 6px; font-size: 24px; letter-spacing:-.02em; }
      .meta{ color:#334155; display:grid; gap:4px; }
      .card{ margin-top:16px; border:1px solid #e5e7eb; border-radius:16px; padding:16px; }
      table{ width:100%; border-collapse:collapse; margin-top:12px; }
      th,td{ border-bottom:1px solid #eef2f7; padding:10px 8px; vertical-align:top; }
      th{ text-align:left; font-weight:900; font-size:12px; color:#475569; }
      .totals{ display:flex; justify-content:flex-end; margin-top: 12px; }
      .totals-box{ width: 380px; border:1px solid #e5e7eb; border-radius:14px; padding:12px 14px; }
      .row{ display:flex; justify-content:space-between; padding:6px 0; }
      .row strong{ font-weight:900; }
      .muted{ color:#64748b; }
      .sign{ display:grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 20px; }
      .line{ margin-top: 32px; border-top:1px solid #cbd5e1; padding-top:6px; }
      @media print{ .no-print{ display:none; } body{ -webkit-print-color-adjust: exact; } }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="top">
        <div>
          <div class="brand">HOME FEST CRM/ERP</div>
          <h1>${titulo}</h1>
          <div class="meta">
            <div><strong>Contratante:</strong> ${clienteNome}</div>
            <div><strong>Evento:</strong> ${eventoTipo} • ${eventoData} • ${convidados} convidados</div>
            <div><strong>Forma:</strong> ${forma}</div>
            <div><strong>Nº contrato:</strong> ${contratoNum} • <span class="muted">Versão v${versaoNum} • ${criadoEm}</span></div>
          </div>
        </div>
        <div style="text-align:right;">
          <span class="tag">Status: ${escapeHtml(contrato.status || 'rascunho')}</span>
          <div class="muted" style="margin-top:10px;">Impressão/PDF: use o botão do navegador.</div>
        </div>
      </div>

      <div class="card">
        <div style="font-weight:900;">Itens e valores</div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Descrição</th><th style="text-align:right;">Qtd</th><th style="text-align:right;">Unit.</th><th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="5" class="muted">Sem itens</td></tr>'}</tbody>
        </table>

        <div class="totals">
          <div class="totals-box">
            <div class="row"><span>Subtotal</span><span>${money(totals.subtotal)}</span></div>
            <div class="row"><span>Desconto</span><span>${money(totals.desconto)}</span></div>
            <div class="row"><strong>Total</strong><strong>${money(totals.total)}</strong></div>
          </div>
        </div>

        ${termosHtml}

        <div class="sign">
          <div class="line"><div class="muted">Assinatura do Contratante</div></div>
          <div class="line"><div class="muted">Assinatura HOME FEST</div></div>
        </div>
      </div>
    </div>
  </body>
  </html>`;

  return doc;
}

export async function contratosAPI(request, env) {
  const url = new URL(request.url);

  // Public acceptance endpoints (no session).
  if (url.pathname.startsWith('/api/contratos/aceite')) {
    return contratosPublicAPI(request, env);
  }

  const auth = getAuth(request);
  const tenantErr = requireTenant(auth);
  if (tenantErr) return tenantErr;

  const parts = url.pathname.split('/').filter(Boolean); // api contratos :id ...
  const id = parts[2];
  const action = parts[3];
  const actionLower = String(action || '').toLowerCase();

  // RBAC
  if (request.method === 'GET') {
    const permErr = await requirePermission(env, auth, 'contratos', 'read');
    if (permErr) return permErr;
  }
  if (request.method === 'POST') {
    // Most writes are create/update
    const perm = (actionLower === 'from-proposta') ? 'create' : 'update';
    const permErr = await requirePermission(env, auth, 'contratos', perm);
    if (permErr) return permErr;
  }

  // List contracts for an event
  // GET /api/contratos?evento_id=123
  if (request.method === 'GET' && !id) {
    const eventoId = Number(url.searchParams.get('evento_id') || 0);
    if (!Number.isFinite(eventoId) || eventoId <= 0) return fail(400, 'BAD_REQUEST', 'evento_id é obrigatório.');
    const ev = await getEventoTenant(env, eventoId, auth.empresaId);
    if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado.');

    const rows = await env.DB.prepare(
      `SELECT c.id, c.status, c.versao_atual_id, c.criado_em, c.atualizado_em,
              v.id as versao_id, v.numero_versao, v.status as versao_status, v.criado_em as versao_criado_em
         FROM contratos c
         LEFT JOIN contrato_versoes v ON v.id = c.versao_atual_id
        WHERE c.empresa_id = ? AND c.evento_id = ?
        ORDER BY c.id DESC`
    ).bind(auth.empresaId, eventoId).all();

    return ok({ contratos: rows.results || [] });
  }

  // Create contract from accepted proposal
  // POST /api/contratos/from-proposta { evento_id, proposta_id }
  if (request.method === 'POST' && actionLower === 'from-proposta') {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido.');
    const { evento_id, proposta_id } = parsed.body || {};
    const eventoId = Number(evento_id || 0);
    const propostaId = Number(proposta_id || 0);
    if (!eventoId || !propostaId) return fail(400, 'BAD_REQUEST', 'evento_id e proposta_id são obrigatórios.');

    const ev = await getEventoTenant(env, eventoId, auth.empresaId);
    if (!ev) return fail(404, 'NOT_FOUND', 'Evento não encontrado.');

    // Load proposal and ensure accepted
    const prop = await env.DB.prepare('SELECT * FROM propostas WHERE id=?').bind(propostaId).first();
    if (!prop) return fail(404, 'NOT_FOUND', 'Proposta não encontrada.');
    if (Number(prop.empresa_id) !== Number(auth.empresaId) || Number(prop.evento_id) !== Number(eventoId)) {
      return fail(404, 'NOT_FOUND', 'Proposta não encontrada.');
    }
    const st = String(prop.status || '').toLowerCase();
    if (st !== 'aceito') return fail(409, 'INVALID_STATE', 'A proposta precisa estar ACEITA para gerar contrato.');

    // Prevent duplicate contract from same proposal (tenant-safe)
    const existing = await env.DB.prepare('SELECT id FROM contratos WHERE empresa_id=? AND evento_id=? AND proposta_versao_id=? LIMIT 1')
      .bind(auth.empresaId, eventoId, prop.id).first();
    if (existing) return ok({ contrato_id: existing.id, reused: true });

    let payload = {};
    try { payload = JSON.parse(prop.payload_json || '{}'); } catch { payload = {}; }
    // Embed proposal identifiers into snapshot (without leaking across tenants)
    payload.id = prop.id;
    payload.versao = prop.versao;
    const snapshot = snapshotDefaultsFromProposta(payload);
    const snapshotStr = JSON.stringify(snapshot);
    const hash = await sha256Hex(snapshotStr);

    // Create header
    const h = await env.DB.prepare(
      `INSERT INTO contratos (empresa_id, cliente_id, evento_id, proposta_versao_id, status, criado_em, atualizado_em)
       VALUES (?, ?, ?, ?, 'ativo', datetime('now'), datetime('now'))`
    ).bind(auth.empresaId, ev.cliente_id, eventoId, prop.id).run();
    const contratoId = h.meta.last_row_id;

    // Create first immutable version
    const v = await env.DB.prepare(
      `INSERT INTO contrato_versoes (empresa_id, contrato_id, numero_versao, status, snapshot_json, hash, gerado_em, criado_por_user_id, criado_em)
       VALUES (?, ?, 1, 'emitido', ?, ?, datetime('now'), ?, datetime('now'))`
    ).bind(auth.empresaId, contratoId, snapshotStr, hash, auth.userId).run();
    const versaoId = v.meta.last_row_id;

    await env.DB.prepare('UPDATE contratos SET versao_atual_id=?, atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=?')
      .bind(versaoId, contratoId, auth.empresaId).run();

    await logAudit(env, request, auth, { modulo: 'contratos', acao: 'create', entidade: 'contratos', entidadeId: contratoId });

    return ok({ contrato_id: contratoId, versao_id: versaoId });
  }

  // Generate an acceptance link (token) for current version
  // POST /api/contratos/:id/aceite-link
  if (request.method === 'POST' && id && actionLower === 'aceite-link') {
    const contrato = await getContratoHeader(env, id, auth.empresaId);
    if (!contrato || !contrato.versao_atual_id) return fail(404, 'NOT_FOUND', 'Contrato não encontrado.');
    const versao = await getContratoVersao(env, contrato.versao_atual_id, auth.empresaId);
    if (!versao) return fail(404, 'NOT_FOUND', 'Contrato não encontrado.');

    const token = makeToken();
    const tokenHash = await sha256Hex(token);

    // Store token_hash best-effort (allows multiple links)
    await env.DB.prepare(
      `INSERT INTO contrato_aceites (empresa_id, contrato_versao_id, token_hash, ip, user_agent, aceito_em)
       VALUES (?, ?, ?, ?, ?, NULL)`
    ).bind(
      auth.empresaId,
      versao.id,
      tokenHash,
      request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '',
      request.headers.get('user-agent') || ''
    ).run();

    const link = new URL('/aceite-contrato.html', url.origin);
    link.searchParams.set('contrato', String(contrato.id));
    link.searchParams.set('token', token);

    await logAudit(env, request, auth, { modulo: 'contratos', acao: 'update', entidade: 'contratos', entidadeId: contrato.id });
    return ok({ link: link.toString() });
  }

  // Render contract HTML (authenticated)
  // GET /api/contratos/:id/render?versao_id=...
  if (request.method === 'GET' && id && actionLower === 'render') {
    const contrato = await getContratoHeader(env, id, auth.empresaId);
    if (!contrato) return html('<h1>Contrato não encontrado</h1>', 404);
    const versaoId = Number(url.searchParams.get('versao_id') || contrato.versao_atual_id || 0);
    if (!versaoId) return html('<h1>Contrato sem versão</h1>', 404);
    const versao = await getContratoVersao(env, versaoId, auth.empresaId);
    if (!versao) return html('<h1>Contrato não encontrado</h1>', 404);
    const doc = await renderContratoHtml(env, auth.empresaId, contrato, versao);
    return html(doc, 200);
  }

  // Get contract JSON (header + versions)
  // GET /api/contratos/:id
  if (request.method === 'GET' && id && !action) {
    const contrato = await getContratoHeader(env, id, auth.empresaId);
    if (!contrato) return fail(404, 'NOT_FOUND', 'Contrato não encontrado.');
    const versoes = await env.DB.prepare('SELECT id, numero_versao, status, criado_em, gerado_em FROM contrato_versoes WHERE empresa_id=? AND contrato_id=? ORDER BY numero_versao DESC')
      .bind(auth.empresaId, id).all();
    return ok({ contrato, versoes: versoes.results || [] });
  }

  return fail(404, 'NOT_FOUND', 'Rota não encontrada.');
}

async function contratosPublicAPI(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean); // api contratos aceite ...
  const action = parts[3];
  const actionLower = String(action || '').toLowerCase();

  // GET /api/contratos/aceite/render?contrato=ID&token=...
  if (request.method === 'GET' && actionLower === 'render') {
    const contratoId = Number(url.searchParams.get('contrato') || 0);
    const token = String(url.searchParams.get('token') || '').trim();
    if (!contratoId || !token) return html('<h1>Link inválido</h1>', 400);

    const tokenHash = await sha256Hex(token);
    const row = await env.DB.prepare(
      `SELECT a.empresa_id, a.contrato_versao_id, a.aceito_em,
              c.id as contrato_id, c.evento_id, c.cliente_id, c.status, c.versao_atual_id
         FROM contrato_aceites a
         JOIN contrato_versoes v ON v.id = a.contrato_versao_id
         JOIN contratos c ON c.id = v.contrato_id
        WHERE a.token_hash = ?
        LIMIT 1`
    ).bind(tokenHash).first();
    if (!row) return html('<h1>Link inválido ou expirado</h1>', 404);

    const contrato = await env.DB.prepare('SELECT * FROM contratos WHERE id=? AND empresa_id=?').bind(row.contrato_id, row.empresa_id).first();
    const versao = await env.DB.prepare('SELECT * FROM contrato_versoes WHERE id=? AND empresa_id=?').bind(row.contrato_versao_id, row.empresa_id).first();
    if (!contrato || !versao) return html('<h1>Contrato não encontrado</h1>', 404);

    const doc = await renderContratoHtml(env, row.empresa_id, contrato, versao);
    // Note: acceptance UI is served by /aceite-contrato.html, not embedded here.
    return html(doc, 200);
  }

  // POST /api/contratos/aceite { contrato_id, token, nome, documento }
  if (request.method === 'POST' && actionLower === '') {
    const parsed = await safeJsonBody(request);
    if (!parsed.ok) return fail(400, 'BAD_REQUEST', 'JSON inválido.');
    const { contrato_id, token, nome, documento } = parsed.body || {};
    const contratoId = Number(contrato_id || 0);
    const tok = String(token || '').trim();
    if (!contratoId || !tok) return fail(400, 'BAD_REQUEST', 'contrato_id e token são obrigatórios.');
    const tokenHash = await sha256Hex(tok);

    const row = await env.DB.prepare(
      `SELECT a.id, a.empresa_id, a.contrato_versao_id, a.aceito_em,
              c.id as contrato_id, c.status
         FROM contrato_aceites a
         JOIN contrato_versoes v ON v.id = a.contrato_versao_id
         JOIN contratos c ON c.id = v.contrato_id
        WHERE a.token_hash = ? AND c.id = ?
        LIMIT 1`
    ).bind(tokenHash, contratoId).first();
    if (!row) return fail(404, 'NOT_FOUND', 'Link inválido ou expirado.');
    if (row.aceito_em) return ok({ already: true });

    // Mark accepted (one-time)
    await env.DB.prepare(
      `UPDATE contrato_aceites
          SET nome=?, documento=?, ip=?, user_agent=?, aceito_em=datetime('now')
        WHERE id=? AND empresa_id=? AND token_hash=? AND aceito_em IS NULL`
    ).bind(
      String(nome || '').slice(0, 160),
      String(documento || '').slice(0, 40),
      request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || '',
      request.headers.get('user-agent') || '',
      row.id,
      row.empresa_id,
      tokenHash,
    ).run();

    // Update contract status and version status best-effort
    await env.DB.prepare('UPDATE contratos SET status=\'ativo\', atualizado_em=datetime(\'now\') WHERE id=? AND empresa_id=?')
      .bind(contratoId, row.empresa_id).run();
    await env.DB.prepare('UPDATE contrato_versoes SET status=\'assinado\' WHERE id=? AND empresa_id=?')
      .bind(row.contrato_versao_id, row.empresa_id).run();

    return ok({ accepted: true });
  }

  return fail(404, 'NOT_FOUND', 'Rota não encontrada.');
}
