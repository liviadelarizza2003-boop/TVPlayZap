-- ============================================================
-- LIVIA BOT — Schema do banco PostgreSQL (Supabase)
-- ============================================================

-- Configurações do sistema (chave/valor)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Clientes com controle de vencimento de plano
CREATE TABLE IF NOT EXISTS clients (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL UNIQUE,   -- formato: 5511999999999
  plan           TEXT,                   -- nome do plano/serviço
  due_date       TEXT,                   -- YYYY-MM-DD
  notes          TEXT,
  is_active      INTEGER DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- FAQ — respostas automáticas
CREATE TABLE IF NOT EXISTS faq (
  id          SERIAL PRIMARY KEY,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  keywords    TEXT,                      -- palavras-chave extras, separadas por vírgula
  usage_count INTEGER DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Candidatas a FAQ (geradas pelo onboarding de histórico ou pela IA em tempo real)
CREATE TABLE IF NOT EXISTS faq_candidates (
  id               SERIAL PRIMARY KEY,
  question         TEXT NOT NULL,         -- pergunta sugerida pela IA
  answer           TEXT NOT NULL,         -- resposta sugerida pela IA
  source_messages  TEXT,                  -- JSON com mensagens originais que geraram esta sugestão
  status           TEXT DEFAULT 'pending', -- pending | approved | edited | rejected
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Clientes sugeridos pela IA a partir do histórico de conversas (revisão manual antes de virar cliente real)
CREATE TABLE IF NOT EXISTS client_candidates (
  id               SERIAL PRIMARY KEY,
  name             TEXT,                   -- nome sugerido (pode vir vazio se a IA não identificou)
  phone            TEXT NOT NULL,
  plan             TEXT,
  due_date         TEXT,                   -- YYYY-MM-DD, pode vir nulo
  source_messages  TEXT,                   -- JSON com trechos que geraram a sugestão
  status           TEXT DEFAULT 'pending', -- pending | approved | rejected
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- Log de lembretes de vencimento enviados (evita duplicatas)
CREATE TABLE IF NOT EXISTS renewal_notifications (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER REFERENCES clients(id),
  sent_at    TIMESTAMPTZ DEFAULT now(),
  due_date   TEXT NOT NULL,              -- vencimento que gerou o lembrete
  status     TEXT DEFAULT 'sent'        -- sent | failed
);

-- Chaves do protocolo Signal do Baileys (sessão de login do WhatsApp).
-- As credenciais (creds) ficam na tabela config, chave 'whatsapp_creds'.
-- Guardar isso no Postgres em vez de arquivo local é o que permite a sessão
-- sobreviver a redeploys no Render (que não tem disco persistente no free tier).
CREATE TABLE IF NOT EXISTS whatsapp_keys (
  type    TEXT NOT NULL,
  key_id  TEXT NOT NULL,
  value   TEXT NOT NULL,
  PRIMARY KEY (type, key_id)
);

-- Log de mensagens recebidas/enviadas (para histórico e debug)
CREATE TABLE IF NOT EXISTS messages_log (
  id          SERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  direction   TEXT NOT NULL,            -- inbound | outbound
  body        TEXT NOT NULL,
  answered_by TEXT,                     -- 'faq' | 'fallback' | 'human' | 'reminder'
  faq_id      INTEGER REFERENCES faq(id),
  confidence  REAL,
  sent_at     TIMESTAMPTZ DEFAULT now()
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_clients_phone    ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_due_date ON clients(due_date, is_active);
CREATE INDEX IF NOT EXISTS idx_faq_active       ON faq(is_active);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON faq_candidates(status);
CREATE INDEX IF NOT EXISTS idx_client_candidates_status ON client_candidates(status);
CREATE INDEX IF NOT EXISTS idx_client_candidates_phone  ON client_candidates(phone);
CREATE INDEX IF NOT EXISTS idx_renewal_client   ON renewal_notifications(client_id, due_date);
CREATE INDEX IF NOT EXISTS idx_messages_phone   ON messages_log(phone, sent_at);

-- Configurações padrão
INSERT INTO config (key, value) VALUES
  ('business_name',       'Meu Negócio'),
  ('owner_phone',         ''),
  ('working_hours_start', '9'),
  ('working_hours_end',   '18'),
  ('fallback_message',    'Olá! 😊 Vou chamar a Lívia para você. Aguarde um momentinho!'),
  ('off_hours_message',   'Olá! Nosso horário de atendimento é das {start}h às {end}h. Retornaremos em breve! 😊'),
  ('reminder_message',    'Olá, {name}! 👋 Passando pra lembrar que seu plano *{plan}* vence dia *{due_date}*. Quer renovar? É só me avisar! 😊')
ON CONFLICT (key) DO NOTHING;
