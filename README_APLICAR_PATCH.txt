FASE 2.2 - PATCH HARDENED (NÃO DÁ 1101)

✅ O que este ZIP faz:
- Adiciona src/routes/central.js (Central / Checklist / Pagamento)
- Substitui src/worker.js com roteamento correto + try/catch global + fallback assets
- Adiciona migrations/central_fase_2_2.sql

COMO APLICAR (Windows):
1) Extraia este ZIP.
2) Copie as pastas 'src' e 'migrations' para dentro do seu projeto, MESCLANDO com as existentes.
   (vai criar o arquivo central.js e substituir worker.js)

3) Garanta seu wrangler.jsonc com:
   "assets": { "directory": "./public" }
   e D1 binding DB apontando para o database_id correto.

4) Rode:
   wrangler deploy
   wrangler d1 execute DB --file=migrations/central_fase_2_2.sql --remote
   wrangler deploy

TESTE:
- https://SEU-DOMINIO/app/festas.html  (deve abrir HTML, sem 1101)
- Pegue um id válido e teste:
  https://SEU-DOMINIO/api/eventos/ID/central
