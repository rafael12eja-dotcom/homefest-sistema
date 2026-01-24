// src/routes/equipe.js
// Equipe do Evento - Fase 2.3 (Hardened: nunca derruba o worker)

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

function toInt(v, def = 0) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function toNum(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function arredondar(valor, regra) {
  regra = (regra || "CEIL").toUpperCase();
  if (regra === "FLOOR") return Math.floor(valor);
  if (regra === "ROUND") return Math.round(valor);
  return Math.ceil(valor);
}

function calcSugestao(convidados, cargo) {
  const tipo = (cargo.calc_tipo || "FIXED").toUpperCase();
  const min = Math.max(0, toInt(cargo.calc_min, 0));
  if (tipo === "PER_GUEST") {
    const div = toInt(cargo.calc_divisor, 0);
    if (div <= 0) return min;
    return Math.max(min, arredondar(convidados / div, cargo.calc_round));
  }
  return min;
}

async function ensureEquipeTables(db) {
  const t1 = await tableExists(db, "equipe_cargos");
  const t2 = await tableExists(db, "evento_equipe");
  return { ok: t1 && t2, equipe_cargos: t1, evento_equipe: t2 };
}

async function getEvento(db, eventoId) {
  return await db
    .prepare("SELECT id, convidados, valor_total FROM eventos WHERE id = ?")
    .bind(eventoId)
    .first();
}

async function getCargos(db) {
  const res = await db.prepare(`
    SELECT id, codigo, nome, descricao, ordem, calc_tipo, calc_divisor, calc_min, calc_round, custo_padrao
    FROM equipe_cargos
    WHERE ativo = 1
    ORDER BY ordem ASC, id ASC
  `).all();
  return res.results || [];
}

async function getLinhas(db, eventoId) {
  const res = await db.prepare(`
    SELECT cargo_id, quantidade, custo_unitario, custo_total, auto_calculado, observacao, atualizado_em
    FROM evento_equipe
    WHERE evento_id = ?
  `).bind(eventoId).all();
  const map = new Map();
  for (const r of (res.results || [])) map.set(r.cargo_id, r);
  return map;
}

async function upsertLinha(db, eventoId, cargoId, data) {
  return await db.prepare(`
    INSERT INTO evento_equipe (
      evento_id, cargo_id,
      quantidade, custo_unitario, custo_total,
      auto_calculado, observacao, atualizado_em
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(evento_id, cargo_id) DO UPDATE SET
      quantidade = excluded.quantidade,
      custo_unitario = excluded.custo_unitario,
      custo_total = excluded.custo_total,
      auto_calculado = excluded.auto_calculado,
      observacao = excluded.observacao,
      atualizado_em = datetime('now')
  `).bind(
    eventoId,
    cargoId,
    data.quantidade,
    data.custo_unitario,
    data.custo_total,
    data.auto_calculado,
    data.observacao || null
  ).run();
}

function montarResposta(evento, cargos, linhasMap) {
  const convidados = toInt(evento.convidados, 0);

  const itens = cargos.map((c) => {
    const row = linhasMap.get(c.id);
    const sugestao = calcSugestao(convidados, c);

    const quantidade = row ? toInt(row.quantidade, 0) : sugestao;
    const custo_unitario = row ? toNum(row.custo_unitario, toNum(c.custo_padrao, 0)) : toNum(c.custo_padrao, 0);
    const custo_total = row ? toNum(row.custo_total, quantidade * custo_unitario) : (quantidade * custo_unitario);

    return {
      cargo_id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      descricao: c.descricao,
      regra: {
        calc_tipo: c.calc_tipo,
        calc_divisor: c.calc_divisor,
        calc_min: c.calc_min,
        calc_round: c.calc_round,
      },
      sugestao_quantidade: sugestao,
      quantidade,
      custo_unitario,
      custo_total,
      auto_calculado: row ? !!row.auto_calculado : true,
      observacao: row?.observacao || "",
      atualizado_em: row?.atualizado_em || null,
    };
  });

  const total_custo_equipe = itens.reduce((acc, it) => acc + toNum(it.custo_total, 0), 0);
  const valor_total_evento = toNum(evento.valor_total, 0);
  const lucro_bruto_estimado = valor_total_evento - total_custo_equipe;

  return {
    evento_id: evento.id,
    convidados,
    valor_total_evento,
    total_custo_equipe,
    lucro_bruto_estimado,
    itens,
  };
}

async function lerJson(request) {
  try {
    const ct = request.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return null;
    return await request.json();
  } catch {
    return null;
  }
}

export async function equipeAPI(request, env, eventoId) {
  const db = env.DB;
  const url = new URL(request.url);
  const pathname = url.pathname;

  try {
    const chk = await ensureEquipeTables(db);
    if (!chk.ok) {
      return json({
        ok: false,
        error: "Módulo de equipe não inicializado (tabelas faltando).",
        hint: "Aplique a migration: migrations/central_fase_2_3.sql",
        tables: chk,
      }, 400);
    }

    const evento = await getEvento(db, eventoId);
    if (!evento) return json({ ok: false, error: "Evento não encontrado", eventoId }, 404);

    const isRecalcular = /\/equipe\/recalcular\/?$/.test(pathname);

    if (request.method === "GET") {
      const cargos = await getCargos(db);
      const linhasMap = await getLinhas(db, eventoId);
      const payload = montarResposta(evento, cargos, linhasMap);
      return json({ ok: true, ...payload });
    }

    if (request.method === "POST" && isRecalcular) {
      const cargos = await getCargos(db);
      const linhasMap = await getLinhas(db, eventoId);
      const convidados = toInt(evento.convidados, 0);

      // recalcula apenas linhas auto ou inexistentes
      for (const c of cargos) {
        const existing = linhasMap.get(c.id);
        if (existing && !existing.auto_calculado) continue;

        const quantidade = calcSugestao(convidados, c);
        const custo_unitario = existing ? toNum(existing.custo_unitario, toNum(c.custo_padrao, 0)) : toNum(c.custo_padrao, 0);
        const custo_total = quantidade * custo_unitario;

        await upsertLinha(db, eventoId, c.id, {
          quantidade,
          custo_unitario,
          custo_total,
          auto_calculado: 1,
          observacao: existing?.observacao || "",
        });
      }

      const linhasMap2 = await getLinhas(db, eventoId);
      const payload = montarResposta(evento, cargos, linhasMap2);
      return json({ ok: true, recalculado: true, ...payload });
    }

    if (request.method === "PUT") {
      const body = await lerJson(request);
      if (!body) return json({ ok: false, error: "JSON inválido" }, 400);

      const cargoId = toInt(body.cargo_id, 0);
      if (!cargoId) return json({ ok: false, error: "cargo_id é obrigatório" }, 400);

      const quantidade = Math.max(0, toInt(body.quantidade, 0));
      const custo_unitario = Math.max(0, toNum(body.custo_unitario, 0));
      const custo_total = quantidade * custo_unitario;
      const observacao = typeof body.observacao === "string" ? body.observacao : "";

      await upsertLinha(db, eventoId, cargoId, {
        quantidade,
        custo_unitario,
        custo_total,
        auto_calculado: 0,
        observacao,
      });

      const cargos = await getCargos(db);
      const linhasMap = await getLinhas(db, eventoId);
      const payload = montarResposta(evento, cargos, linhasMap);
      return json({ ok: true, atualizado: true, ...payload });
    }

    return json({ ok: false, error: "Método não suportado" }, 405);
  } catch (err) {
    return json({
      ok: false,
      error: "Erro interno no módulo de equipe",
      message: err?.message || String(err),
      eventoId,
    }, 500);
  }
}
