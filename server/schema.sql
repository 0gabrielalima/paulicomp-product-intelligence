-- PAULICOMP | Product Intelligence - esquema do banco (PostgreSQL)
-- Camadas: (1) dados originais Lenovo -> (2) dados coletados nas fontes -> (3) consolidacao IA -> (4) validacao humana.
-- Nenhuma camada sobrescreve outra: tabelas de pesquisa/IA/validacao sao append-only com versoes.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  roles TEXT[] NOT NULL DEFAULT ARRAY['consulta'],   -- admin | pesquisador | validador | consulta
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id)
);

-- Categorias padronizadas e campos tecnicos dinamicos por categoria
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  fields JSONB NOT NULL DEFAULT '[]'          -- [{key,label}]
);
-- Mapeia o texto "Commodity" da Lenovo para uma categoria padronizada (texto original e preservado no registro bruto)
CREATE TABLE IF NOT EXISTS category_aliases (
  raw TEXT PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id)
);

-- ---------- Camada 1: dados originais ----------
CREATE TABLE IF NOT EXISTS lots (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  received_at DATE,
  source_filename TEXT,
  sheet_name TEXT,
  column_map JSONB NOT NULL,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lot_raw_rows (
  id SERIAL PRIMARY KEY,
  lot_id INT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  sku TEXT,
  description TEXT,
  quantity NUMERIC,
  raw JSONB NOT NULL,                          -- linha completa, todas as colunas, como veio na planilha
  issues JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS lot_raw_rows_lot ON lot_raw_rows(lot_id);

-- Registro mestre por SKU (base de conhecimento permanente)
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  first_seen_lot_id INT REFERENCES lots(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um item por SKU por lote (duplicatas da planilha agregadas aqui, mantendo vinculo com as linhas originais)
CREATE TABLE IF NOT EXISTS lot_items (
  id SERIAL PRIMARY KEY,
  lot_id INT NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 0,
  raw_row_ids INT[] NOT NULL,
  original_description TEXT,
  original_commodity TEXT,
  existed_before BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (lot_id, product_id)
);

-- ---------- Camada 2: dados coletados ----------
CREATE TABLE IF NOT EXISTS research_runs (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  lot_id INT REFERENCES lots(id),
  kind TEXT NOT NULL,                          -- completa | precos | tecnica | ia
  status TEXT NOT NULL DEFAULT 'na_fila',      -- na_fila | em_andamento | concluida | parcial | falha | cancelada | pausada
  requested_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS research_runs_product ON research_runs(product_id);

CREATE TABLE IF NOT EXISTS research_steps (
  id SERIAL PRIMARY KEY,
  run_id INT NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  step TEXT NOT NULL,
  source TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'pendente',     -- pendente | executando | concluida | parcial | falha | ignorada | nao_configurada | aguardando_manual | bloqueada | cancelada
  attempts INT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error TEXT,
  log JSONB NOT NULL DEFAULT '[]',
  cost_usd NUMERIC NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS research_steps_run ON research_steps(run_id);

-- Fila persistente (funciona em Postgres real e no PGlite)
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',       -- queued | running | done | failed | paused | cancelled
  priority INT NOT NULL DEFAULT 0,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_dedupe_active ON jobs(dedupe_key) WHERE status IN ('queued','running','paused');
CREATE INDEX IF NOT EXISTS jobs_pick ON jobs(status, run_after, priority);

-- Toda informacao coletada aponta para uma fonte rastreavel
CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  run_id INT REFERENCES research_runs(id),
  source_type TEXT NOT NULL,                   -- lenovo_parts_lookup | psref | fabricante | marketplace | indice_busca | manual
  url TEXT,
  title TEXT,
  reference TEXT,                              -- ex.: "arquivo importado X" quando nao ha URL
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS product_codes (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  code TEXT NOT NULL,
  code_type TEXT NOT NULL,                     -- fru | part_number | substituto | equivalente | pn_fabricante | modelo
  confirmation TEXT NOT NULL,                  -- oficial | fonte_complementar | hipotese
  source_id INT REFERENCES sources(id),
  run_id INT REFERENCES research_runs(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_codes_product ON product_codes(product_id);
CREATE INDEX IF NOT EXISTS product_codes_code ON product_codes(code);

CREATE TABLE IF NOT EXISTS tech_facts (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  run_id INT REFERENCES research_runs(id),
  source_id INT REFERENCES sources(id),
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  confirmation TEXT NOT NULL DEFAULT 'fonte_complementar',  -- oficial | fonte_complementar | hipotese
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tech_facts_product ON tech_facts(product_id);

CREATE TABLE IF NOT EXISTS product_images (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  url TEXT NOT NULL,
  source_id INT REFERENCES sources(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, url)
);

CREATE TABLE IF NOT EXISTS compatibilities (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  run_id INT REFERENCES research_runs(id),
  source_id INT REFERENCES sources(id),
  brand TEXT, line TEXT, family TEXT, model TEXT, machine_type TEXT, machine_code TEXT,
  confirmation TEXT NOT NULL,                  -- oficial_sku | oficial_modelo | tecnica_generica | fonte_complementar | necessita_validacao
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS compat_product ON compatibilities(product_id);

CREATE TABLE IF NOT EXISTS fx_quotes (
  id SERIAL PRIMARY KEY,
  currency TEXT NOT NULL,
  rate NUMERIC NOT NULL,                       -- BRL por 1 unidade da moeda
  source TEXT NOT NULL,
  quoted_at TIMESTAMPTZ NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB
);

CREATE TABLE IF NOT EXISTS listings (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  run_id INT REFERENCES research_runs(id),
  market TEXT NOT NULL,                        -- nacional | internacional
  competition TEXT NOT NULL DEFAULT 'direta',  -- direta | indireta
  store TEXT, marketplace TEXT, seller TEXT, country TEXT,
  title TEXT NOT NULL, title_translated TEXT,
  sku_informed TEXT, pn_informed TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  price_original NUMERIC,                      -- preco a vista na moeda original
  price_installment NUMERIC, installments INT,
  fx_quote_id INT REFERENCES fx_quotes(id),
  fx_rate NUMERIC, fx_source TEXT, fx_at TIMESTAMPTZ,
  price_brl NUMERIC,                           -- congelado na data da pesquisa
  shipping NUMERIC, taxes NUMERIC,
  condition TEXT NOT NULL DEFAULT 'nao_informada',         -- nova | usada | recondicionada | retirada_equipamento | nao_informada
  originality TEXT NOT NULL DEFAULT 'nao_confirmada',      -- original_confirmada | anunciada_original | paralela | nao_confirmada
  commercial_version TEXT NOT NULL DEFAULT 'nao_identificada', -- oem | tray | box | retail | nao_identificada
  availability TEXT NOT NULL DEFAULT 'estoque_nao_confirmado', -- disponivel | sob_encomenda | estoque_nao_confirmado | indisponivel | esgotado | vendido | encerrado | inacessivel | bloqueio
  qty_available INT, qty_sold INT, delivery TEXT,
  url TEXT NOT NULL,
  price_origin TEXT NOT NULL DEFAULT 'pagina', -- pagina | indexado | manual
  match_type TEXT NOT NULL,                    -- sku_exato | codigo_equivalente_oficial | mesmo_modelo | equivalencia_nao_confirmada | tecnicamente_semelhante | substituto_comercial | incompativel
  match_evidence TEXT,
  is_own BOOLEAN NOT NULL DEFAULT FALSE,
  dedupe_key TEXT,
  excluded BOOLEAN NOT NULL DEFAULT FALSE,
  exclusion_reason TEXT,
  excluded_by INT REFERENCES users(id),
  notes TEXT,
  added_by INT REFERENCES users(id),           -- preenchido quando inserido manualmente
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_product ON listings(product_id);

-- ---------- Camada 3: consolidacao da IA (versionada) ----------
CREATE TABLE IF NOT EXISTS ai_consolidations (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  run_id INT REFERENCES research_runs(id),
  lot_id INT REFERENCES lots(id),
  version INT NOT NULL,
  model TEXT,
  output JSONB NOT NULL,                       -- saida estruturada validada por schema
  source_ids INT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Camada 4: validacao humana (versionada) ----------
-- Validacao tecnica: por produto (base de conhecimento)
CREATE TABLE IF NOT EXISTS tech_validations (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  version INT NOT NULL,
  status TEXT NOT NULL,                        -- rascunho | aprovada | revisao_solicitada | nao_identificado
  data JSONB NOT NULL,
  based_on_ai_id INT REFERENCES ai_consolidations(id),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tech_val_product ON tech_validations(product_id);

-- Validacao comercial: por item de lote (mesmo SKU pode ter precos diferentes em lotes diferentes)
CREATE TABLE IF NOT EXISTS commercial_validations (
  id SERIAL PRIMARY KEY,
  lot_item_id INT NOT NULL REFERENCES lot_items(id) ON DELETE CASCADE,
  version INT NOT NULL,
  status TEXT NOT NULL,                        -- rascunho | aprovada | revisao_solicitada
  unit_price NUMERIC,
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS com_val_item ON commercial_validations(lot_item_id);

CREATE TABLE IF NOT EXISTS change_log (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INT,
  product_id INT,
  lot_id INT,
  action TEXT NOT NULL,
  field TEXT,
  old_value JSONB,
  new_value JSONB,
  reason TEXT,
  user_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_log_product ON change_log(product_id);

CREATE TABLE IF NOT EXISTS api_usage (
  id SERIAL PRIMARY KEY,
  run_id INT REFERENCES research_runs(id),
  step_id INT REFERENCES research_steps(id),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  tokens_in INT NOT NULL DEFAULT 0,
  tokens_out INT NOT NULL DEFAULT 0,
  web_searches INT NOT NULL DEFAULT 0,
  requests INT NOT NULL DEFAULT 1,
  cost_usd NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fluxo semiautomatico do Lenovo Parts Lookup: blocos de ate 100 SKUs
CREATE TABLE IF NOT EXISTS lenovo_batches (
  id SERIAL PRIMARY KEY,
  lot_id INT REFERENCES lots(id),
  skus TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  imported_at TIMESTAMPTZ,
  imported_by INT REFERENCES users(id),
  import_filename TEXT
);
