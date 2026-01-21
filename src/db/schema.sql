
CREATE TABLE empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT,
  slug TEXT,
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER,
  nome TEXT,
  email TEXT,
  role TEXT,
  ativo INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER,
  nome TEXT,
  telefone TEXT,
  origem TEXT,
  status TEXT,
  observacoes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER,
  nome TEXT,
  telefone TEXT,
  email TEXT,
  documento TEXT,
  endereco TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER,
  cliente_id INTEGER,
  tipo TEXT,
  data TEXT,
  local TEXT,
  convidados INTEGER,
  valor REAL,
  status TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE financeiro (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER,
  evento_id INTEGER,
  tipo TEXT,
  categoria TEXT,
  descricao TEXT,
  valor REAL,
  data TEXT
);
