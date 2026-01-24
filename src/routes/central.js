// src/routes/central.js
// Central da Festa - Fase 2.2 (Hardened: nunca lança exception por tabela faltando)

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function tableExists(db, tableName) {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .bind(tableName)
    .first();
  return !!row;
}


async function ensureEquipeTables(db) {
  const t1 = await tableExists(db, "equipe_cargos");
  const t2 = await tableExists(db, "evento_equipe");
  return { ok: t1 && t2, equipe_cargos: t1, evento_equipe: t2 };
}

async function getEquipeSnapshot(db, evento) {
  // retorna null se tabelas não existirem
  const chk = await ensureEquipeTables(db);
  if (!chk.ok) return { ok: false, hint: "Rode a migration central_fase_2_3.sql", tables: chk };

  const cargos = await db.prepare(`
    SELECT id, codigo, nome, descricao, ordem, calc_tipo, calc_divisor, calc_min, calc_round, custo_padrao
    FROM equipe_cargos
    WHERE ativo = 1
    ORDER BY ordem ASC, id ASC
  `).all();

  const linhas = await db.prepare(`
    SELECT cargo_id, quantidade, custo_unitario, custo_total, auto_calculado, observacao, atualizado_em
    FROM evento_equipe
    WHERE evento_id = ?
  `).bind(evento.id).all();

  const map = new Map();
  for (const r of (linhas.results || [])) map.set(r.cargo_id, r);

  const convidados = Number(evento.convidados || 0);
  function arredondar(valor, regra) {
    regra = (regra || "CEIL").toUpperCase();
    if (regra === "FLOOR") return Math.floor(valor);
    if (regra === "ROUND") return Math.round(valor);
    return Math.ceil(valor);
  }
  function sugestao(c) {
    const tipo = (c.calc_tipo || "FIXED").toUpperCase();
    const min = Math.max(0, Number(c.calc_min || 0));
    if (tipo === "PER_GUEST") {
      const div = Number(c.calc_divisor || 0);
      if (div <= 0) return min;
      return Math.max(min, arredondar(convidados / div, c.calc_round));
    }
    return min;
  }

  const itens = (cargos.results || []).map(c => {
    const row = map.get(c.id);
    const sug = sugestao(c);
    const qtd = row ? Number(row.quantidade || 0) : sug;
    const unit = row ? Number(row.custo_unitario || 0) : Number(c.custo_padrao || 0);
    const total = row ? Number(row.custo_total || (qtd * unit)) : (qtd * unit);
    return {
      cargo_id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      descricao: c.descricao,
      sugestao_quantidade: sug,
      quantidade: qtd,
      custo_unitario: unit,
      custo_total: total,
      auto_calculado: row ? !!row.auto_calculado : true,
      observacao: row?.observacao || "",
      atualizado_em: row?.atualizado_em || null,
    };
  });

  const total_custo_equipe = itens.reduce((acc, it) => acc + Number(it.custo_total || 0), 0);
  const valor_total_evento = Number(evento.valor_total || 0);
  const lucro_bruto_estimado = valor_total_evento - total_custo_equipe;
  const equipe_definida = itens.some(it => Number(it.quantidade || 0) > 0);

  return {
    ok: true,
    evento_id: evento.id,
    convidados,
    total_custo_equipe,
    lucro_bruto_estimado,
    equipe_definida,
    itens,
  };
}

async function ensureCentralTables(db) {
  const okChecklist = await tableExists(db, "evento_checklist");
  const okPagamento = await tableExists(db, "evento_pagamento");
  return { okChecklist, okPagamento, ok: okChecklist && okPagamento };
}

async function getEvento(db, eventoId) {
  return await db
    .prepare("SELECT * FROM eventos WHERE id = ?")
    .bind(eventoId)
    .first();
}

export async function centralAPI(request, env, eventoId) {
  const db = env.DB;

  const evento = await getEvento(db, eventoId);
  if (!evento) 
// Equipe (Fase 2.3) - não quebra se tabelas não existirem
let equipe = null;
let equipeInfo = null;
try {
  equipeInfo = await getEquipeSnapshot(db, evento);
  if (equipeInfo && equipeInfo.ok) {
    equipe = {
      total_custo_equipe: equipeInfo.total_custo_equipe,
      lucro_bruto_estimado: equipeInfo.lucro_bruto_estimado,
      itens: equipeInfo.itens,
    };
    // Ajuste de progresso: +1 marco virtual (Equipe definida)
    total = total + 1;
    if (equipeInfo.equipe_definida) concluidos = concluidos + 1;
    percentual = total > 0 ? Math.round((concluidos / total) * 100) : 0;
  } else if (equipeInfo && equipeInfo.ok === false) {
    // opcional: alerta suave
    alertas.push({ tipo: "info", msg: "Módulo de equipe disponível (aplique a fase 2.3 para ativar)." });
  }
} catch (e) {
  // nunca derrubar a central
}

return json({ error: "Evento não encontrado", eventoId }, 404);

  const chk = await ensureCentralTables(db);
  if (!chk.ok) {
    return json(
      {
        error: "Central da Festa não inicializada (tabelas faltando).",
        evento,
        hint:
          "Rode: wrangler d1 execute DB --file=migrations/central_fase_2_2.sql --remote",
        tables: chk,
      },
      409
    );
  }

  const checklistRes = await db
    .prepare(
      "SELECT chave, titulo, obrigatorio, concluido, ordem FROM evento_checklist WHERE evento_id = ? ORDER BY ordem ASC"
    )
    .bind(eventoId)
    .all();

  const checklist = checklistRes.results || [];
  const total = checklist.length;
  const concluidos = checklist.filter((i) => i.concluido === 1).length;
  const percentual = total === 0 ? 0 : Math.round((concluidos / total) * 100);

  const pagamento = await db
    .prepare("SELECT * FROM evento_pagamento WHERE evento_id = ?")
    .bind(eventoId)
    .first();

  const alertas = [];
  if (pagamento && Number(pagamento.valor_pendente) > 0) {
    alertas.push({ tipo: "warning", msg: "Pagamento pendente no evento." });
  }

  return json({
    evento,
    progresso: { total, concluidos, percentual },
    checklist,
    pagamento: pagamento || null,
    equipe,
    alertas,
  });
}

// Checklist
export async function checklistAPI(request, env, eventoId, chave = null) {
  const db = env.DB;

  const evento = await getEvento(db, eventoId);
  if (!evento) return json({ error: "Evento não encontrado", eventoId }, 404);

  const chk = await ensureCentralTables(db);
  if (!chk.ok) {
    return json(
      {
        error: "Checklist indisponível (tabelas faltando).",
        hint:
          "Rode: wrangler d1 execute DB --file=migrations/central_fase_2_2.sql --remote",
        tables: chk,
      },
      409
    );
  }

  if (request.method === "GET") {
    const res = await db
      .prepare(
        "SELECT chave, titulo, obrigatorio, concluido, ordem FROM evento_checklist WHERE evento_id = ? ORDER BY ordem ASC"
      )
      .bind(eventoId)
      .all();
    return json({ eventoId, checklist: res.results || [] });
  }

  if (request.method === "PATCH" && chave) {
    let body = {};
    try {
      body = await request.json();
    } catch (_) {}

    const concluido = body.concluido === 1 || body.concluido === true ? 1 : 0;

    await db
      .prepare(
        `INSERT INTO evento_checklist (evento_id, chave, titulo, obrigatorio, concluido, ordem)
         VALUES (?, ?, ?, 1, ?, 0)
         ON CONFLICT(evento_id, chave) DO UPDATE SET concluido=excluded.concluido`
      )
      .bind(eventoId, chave, chave, concluido)
      .run();

    return json({ ok: true, eventoId, chave, concluido });
  }

  return json({ error: "Método não suportado" }, 405);
}

// Pagamento
export async function pagamentoAPI(request, env, eventoId) {
  const db = env.DB;

  const evento = await getEvento(db, eventoId);
  if (!evento) return json({ error: "Evento não encontrado", eventoId }, 404);

  const chk = await ensureCentralTables(db);
  if (!chk.ok) {
    return json(
      {
        error: "Pagamento indisponível (tabelas faltando).",
        hint:
          "Rode: wrangler d1 execute DB --file=migrations/central_fase_2_2.sql --remote",
        tables: chk,
      },
      409
    );
  }

  if (request.method === "GET") {
    const pagamento = await db
      .prepare("SELECT * FROM evento_pagamento WHERE evento_id = ?")
      .bind(eventoId)
      .first();
    return json({ eventoId, pagamento: pagamento || null });
  }

  if (request.method === "PUT") {
    const body = await request.json();

    const forma = body.forma || "pix";
    const parcelas = Number(body.parcelas || 1);
    const valor_total = Number(body.valor_total ?? evento.valor_total ?? 0);
    const valor_pago = Number(body.valor_pago || 0);
    const valor_pendente = Math.max(0, valor_total - valor_pago);

    const status =
      valor_pendente <= 0 ? "pago" : valor_pago > 0 ? "parcial" : "pendente";

    await db
      .prepare(
        `INSERT INTO evento_pagamento (evento_id, forma, parcelas, valor_total, valor_pago, valor_pendente, status, detalhes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(evento_id) DO UPDATE SET
           forma=excluded.forma,
           parcelas=excluded.parcelas,
           valor_total=excluded.valor_total,
           valor_pago=excluded.valor_pago,
           valor_pendente=excluded.valor_pendente,
           status=excluded.status,
           detalhes=excluded.detalhes`
      )
      .bind(
        eventoId,
        forma,
        parcelas,
        valor_total,
        valor_pago,
        valor_pendente,
        status,
        JSON.stringify(body.detalhes || {})
      )
      .run();

    return json({
      ok: true,
      eventoId,
      pagamento: {
        forma,
        parcelas,
        valor_total,
        valor_pago,
        valor_pendente,
        status,
      },
    });
  }

  return json({ error: "Método não suportado" }, 405);
}
