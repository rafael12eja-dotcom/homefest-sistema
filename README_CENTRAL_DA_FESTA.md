# Central da Festa (Fase 2.2)

## O que está pronto

### UI
- Página: `/app/festa.html?id=ID`
- Barra de progresso (dourada) + “próxima ação”
- Alertas automáticos (pendências)
- Aba **Checklist** (funcional)
- Aba **Pagamento** (funcional)
- Demais abas permanecem em placeholder (sem quebrar nada)

### API
- Mantido: `GET/PATCH /api/eventos/:id`
- Novo:
  - `GET /api/eventos/:id/central`
  - `GET /api/eventos/:id/checklist`
  - `PATCH /api/eventos/:id/checklist/:chave`
  - `GET /api/eventos/:id/pagamento`
  - `PUT /api/eventos/:id/pagamento`

## Migração D1 (executar uma vez)

> Rode no D1 `homefest-db` antes de usar as novas abas.

```sql
CREATE TABLE IF NOT EXISTS evento_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL,
  chave TEXT NOT NULL,
  titulo TEXT NOT NULL,
  obrigatorio INTEGER NOT NULL DEFAULT 1,
  concluido INTEGER NOT NULL DEFAULT 0,
  concluido_em TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_evento_checklist ON evento_checklist(evento_id, chave);
CREATE INDEX IF NOT EXISTS idx_evento_checklist_evento ON evento_checklist(evento_id);

CREATE TABLE IF NOT EXISTS evento_pagamento (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL UNIQUE,
  forma TEXT,
  parcelas INTEGER NOT NULL DEFAULT 1,
  valor_total REAL NOT NULL DEFAULT 0,
  valor_pago REAL NOT NULL DEFAULT 0,
  valor_pendente REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  detalhes TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  atualizado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_evento_pagamento_evento ON evento_pagamento(evento_id);
```

## Arquivos neste pacote
- `public/app/festa.html`
- `public/css/festa.css`
- `public/js/festa.js`
- `src/routes/eventos.js`
- `src/worker.js`


## Migração D1 (obrigatório)

Execute:

```bash
wrangler d1 execute homefest-db --file=migrations/central_fase_2_2.sql
```
