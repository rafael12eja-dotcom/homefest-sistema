# Home Fest & Eventos — Sistema

CRM e sistema de gestão completo para buffets e eventos.

Módulos:
- Login e autenticação
- Leads (CRM)
- Clientes
- Eventos
- Financeiro
- Contratos
- Patrimônio

Tecnologia:
- Cloudflare Workers
- Cloudflare D1
- Cloudflare R2

## Próximos passos (essencial)
1) No Cloudflare D1 (homefest-db), rode `migrations/002_schema_v2.sql` se for banco novo.
   - Se seu banco já tem dados, rode `scripts/upgrade_d1.sql` no console e ignore erros de coluna duplicada.

2) Deploy:
- Na máquina que não aceita OAuth (request_forbidden), use API Token:
  - `setx CLOUDFLARE_API_TOKEN "SEU_TOKEN_AQUI"` (Windows) ou `$env:CLOUDFLARE_API_TOKEN="SEU_TOKEN_AQUI"` (sessão atual)
  - `npx wrangler deploy`

3) Links de teste:
- Dashboard: `/`
- Leads: `/app/leads.html`
- Clientes: `/app/clientes.html`
- Festas: `/app/festas.html`
- Central da Festa: `/app/festa.html?id=1` (troque o id para um existente)
- API: `/api/dashboard`, `/api/eventos`, `/api/eventos/1`
