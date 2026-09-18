// Backup automático diário — roda via GitHub Actions
// (.github/workflows/backup-db.yml), lê DATABASE_URL de uma secret do repo
// (não do .env). Exporta as tabelas de negócio pra dentro de
// backups/latest/, sobrescrevendo a cada execução — o histórico de versões
// fica no próprio Git (cada commit diário é um diff).
//
// Por quê: perda real de dado aqui tem duas causas possíveis — (1) o banco
// em si sumir (Supabase free pausa depois de 7 dias sem atividade; a Eva
// "grande", C:\Sistemas\eva-test, já perdeu o Postgres do Render assim,
// sem aviso) ou (2) um bug/acidente apagar uma tabela sem querer. Isso
// cobre as duas.
//
// Diferente da Eva grande: esta Eva Lite NÃO tem importHistorySync() nem
// nenhuma outra forma de resincronizar mensagens a partir do WhatsApp —
// perder `messages_log` aqui é perda definitiva, então (ao contrário da
// Eva grande, que deixa mensagens de fora do backup de propósito)
// `messages_log` ENTRA no backup.
//
// NÃO exporta `whatsapp_keys` nem a linha `whatsapp_creds` de `config` —
// são a sessão de login ativa do WhatsApp (equivalente a uma senha).
// Colocar isso num backup versionado no Git (mesmo privado) trocaria "perda
// de dado" por "sessão do WhatsApp exposta a quem tiver acesso ao repo" —
// um risco pior que o que este script existe pra evitar. Reconectar via QR
// novo continua sendo o caminho normal de recuperar a sessão perdida.
//
// Uso: DATABASE_URL=... node scripts/backup_scheduled.js

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Tabelas de negócio, sem outra fonte de recuperação — schema completo em
// src/db/schema.sql. `whatsapp_keys` fica de fora de propósito (ver acima).
const TABELAS = [
  'config',
  'clients',
  'faq',
  'faq_candidates',
  'client_candidates',
  'renewal_notifications',
  'human_pauses',
  'messages_log',
];

// Chaves de `config` que são credenciais/sessão, não configuração de
// negócio — nunca vão pro backup, mesmo a tabela inteira estando na lista
// acima. Mesmo racional do `whatsapp_keys` acima: ver comentário no topo.
// `admin_password_hash` é hash (bcrypt), não senha em texto puro, mas
// mesmo assim não tem motivo pra duplicar credencial de acesso num backup
// versionado — trocar a senha pelo painel continua funcionando normalmente
// sem depender desse valor estar no backup. Mesma regra pra
// `security_answer_hash` (resposta da pergunta secreta): resposta de pergunta
// tem pouca entropia, então o hash dela é bem mais fácil de quebrar offline
// do que o da senha — motivo a mais pra nunca versionar.
const CONFIG_KEYS_SENSIVEIS = ['whatsapp_creds', 'admin_password_hash', 'security_answer_hash'];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não configurada');

  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
  const outDir = path.join(__dirname, '..', 'backups', 'latest');
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = { generatedAt: new Date().toISOString(), tables: {} };

  for (const table of TABELAS) {
    try {
      let rows;
      if (table === 'config') {
        const placeholders = CONFIG_KEYS_SENSIVEIS.map((_, i) => `$${i + 1}`).join(', ');
        const { rows: r } = await pool.query(
          `SELECT * FROM "config" WHERE key NOT IN (${placeholders}) ORDER BY key`,
          CONFIG_KEYS_SENSIVEIS
        );
        rows = r;
      } else {
        const { rows: r } = await pool.query(`SELECT * FROM "${table}" ORDER BY 1`);
        rows = r;
      }
      fs.writeFileSync(path.join(outDir, `${table}.json`), JSON.stringify(rows, null, 2));
      manifest.tables[table] = rows.length;
      console.log(`✓ ${table} — ${rows.length} linhas`);
    } catch (err) {
      manifest.tables[table] = { error: err.message };
      console.error(`✗ ${table}: ${err.message}`);
    }
  }

  fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nBackup concluído em', outDir);
  await pool.end();
}

main().catch(err => { console.error('ERRO FATAL:', err); process.exit(1); });
