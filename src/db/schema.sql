-- ============================================================
-- LIVIA BOT — Schema do banco SQLite
-- ============================================================

-- Configurações do sistema (chave/valor)
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Clientes com controle de vencimento de plano
CREATE TABLE IF NOT EXISTS clients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  phone          TEXT NOT NULL UNIQUE,   -- formato: 5511999999999
  plan           TEXT,                   -- nome do plano/serviço
  due_date       TEXT,                   -- YYYY-MM-DD
  notes          TEXT,
  is_active      INTEGER DEFAULT 1,
  created_at     TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at     TEXT DEFAULT (datetime('now', 'localtime'))
);

-- FAQ — respostas automáticas
CREATE TABLE IF NOT EXISTS faq (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question    TEXT NOT NULL,
  answer      TEXT NOT NULL,
  keywords    TEXT,                      -- palavras-chave extras, separadas por vírgula
  usage_count INTEGER DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now', 'localtime')),
  updated_at  TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Candidatas a FAQ (geradas pelo onboarding de histórico ou pela IA em tempo real)
CREATE TABLE IF NOT EXISTS faq_candidates (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  question         TEXT NOT NULL,         -- pergunta sugerida pela IA
  answer           TEXT NOT NULL,         -- resposta sugerida pela IA
  source_messages  TEXT,                  -- JSON com mensagens originais que geraram esta sugestão
  status           TEXT DEFAULT 'pending', -- pending | approved | edited | rejected
  reviewed_at      TEXT,
  created_at       TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Log de lembretes de vencimento enviados (evita duplicatas)
CREATE TABLE IF NOT EXISTS renewal_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER REFERENCES clients(id),
  sent_at    TEXT DEFAULT (datetime('now', 'localtime')),
  due_date   TEXT NOT NULL,              -- vencimento que gerou o lembrete
  status     TEXT DEFAULT 'sent'        -- sent | failed
);

-- Log de mensagens recebidas/enviadas (para histórico e debug)
CREATE TABLE IF NOT EXISTS messages_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone       TEXT NOT NULL,
  direction   TEXT NOT NULL,            -- inbound | outbound
  body        TEXT NOT NULL,
  answered_by TEXT,                     -- 'faq' | 'fallback' | 'human' | 'reminder'
  faq_id      INTEGER REFERENCES faq(id),
  confidence  REAL,
  sent_at     TEXT DEFAULT (datetime('now', 'localtime'))
);

-- Índices de performance
CREATE INDEX IF NOT EXISTS idx_clients_phone    ON clients(phone);
CREATE INDEX IF NOT EXISTS idx_clients_due_date ON clients(due_date, is_active);
CREATE INDEX IF NOT EXISTS idx_faq_active       ON faq(is_active);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON faq_candidates(status);
CREATE INDEX IF NOT EXISTS idx_renewal_client   ON renewal_notifications(client_id, due_date);
CREATE INDEX IF NOT EXISTS idx_messages_phone   ON messages_log(phone, sent_at);

-- Configurações padrão
INSERT OR IGNORE INTO config (key, value) VALUES
  ('business_name',       'Meu Negócio'),
  ('owner_phone',         ''),
  ('working_hours_start', '9'),
  ('working_hours_end',   '18'),
  ('fallback_message',    'Olá! 😊 Vou chamar a Lívia para você. Aguarde um momentinho!'),
  ('off_hours_message',   'Olá! Nosso horário de atendimento é das {start}h às {end}h. Retornaremos em breve! 😊'),
  ('reminder_message',    'Olá, {name}! 👋 Passando pra lembrar que seu plano *{plan}* vence dia *{due_date}*. Quer renovar? É só me avisar! 😊');
