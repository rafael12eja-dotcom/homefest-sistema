# Home Fest & Eventos — Sistema

## Módulo 1: Login (proteção por sessão)

Este pacote adiciona:
- Tela /login
- POST /api/login (cria cookie de sessão)
- /logout (remove cookie)
- Proteção do app (/) exigindo login

### Variáveis/Segredos no Cloudflare (Workers → Settings → Variables)
Crie **Secrets**:
- `ADMIN_USER` (ex.: admin)
- `ADMIN_PASS_SHA256` (hash SHA-256 da senha)
- `SESSION_SECRET` (string longa aleatória)

#### Gerar SHA-256 da senha no PowerShell
```powershell
$pass = "SUA_SENHA_AQUI"
$bytes = [Text.Encoding]::UTF8.GetBytes($pass)
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
($hash | ForEach-Object { $_.ToString("x2") }) -join ""
```

Depois que configurar, faça um novo deploy (Git push) — o Cloudflare atualiza.
