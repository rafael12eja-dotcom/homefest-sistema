-- Rode estes comandos no Cloudflare D1 Console (homefest-db) UMA VEZ

-- 1) Guardar cidade/bairro no cliente
ALTER TABLE clientes ADD COLUMN cidade TEXT;
ALTER TABLE clientes ADD COLUMN bairro TEXT;

-- 2) Guardar número do contrato e forma de pagamento no evento
ALTER TABLE eventos ADD COLUMN contrato_numero TEXT;
ALTER TABLE eventos ADD COLUMN forma_pagamento TEXT;

-- (Opcional) Índices para performance
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_eventos_cliente ON eventos(cliente_id);
