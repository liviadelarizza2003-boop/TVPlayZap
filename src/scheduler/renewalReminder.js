'use strict';
/**
 * scheduler/renewalReminder.js
 *
 * Roda um job cron todo dia às 9h (horário de Brasília).
 * Verifica clientes cujo plano vence em exatamente 3 dias e ainda não
 * receberam o lembrete para essa data de vencimento.
 * Envia mensagem personalizada pelo WhatsApp via Baileys.
 */

const cron = require('node-cron');
const db   = require('../db/db');

let _sendMessage = null; // injetado pelo bot/index.js após conexão

/** Registra a função de envio do Baileys */
function setSendMessage(fn) {
  _sendMessage = fn;
}

async function getConfigValue(key) {
  return (await db.get('SELECT value FROM config WHERE key = ?', [key]))?.value || '';
}

function formatDate(dateStr) {
  // YYYY-MM-DD → DD/MM/YYYY
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

/** Verifica e envia lembretes. Chamável manualmente para testes. */
async function checkAndSend() {
  if (!_sendMessage) {
    console.warn('[renewalReminder] Função de envio ainda não registrada (bot desconectado?)');
    return { sent: 0, skipped: 0, errors: [] };
  }

  // Data daqui a 3 dias em YYYY-MM-DD
  const target = new Date();
  target.setDate(target.getDate() + 3);
  const targetDate = target.toISOString().split('T')[0];

  // Clientes com vencimento em 3 dias que ainda não receberam lembrete para esta data
  const clients = await db.all(
    `SELECT c.* FROM clients c
     WHERE c.due_date = ?
       AND c.is_active = 1
       AND NOT EXISTS (
         SELECT 1 FROM renewal_notifications n
         WHERE n.client_id = c.id AND n.due_date = ? AND n.status = 'sent'
       )`,
    [targetDate, targetDate]
  );

  const template = (await getConfigValue('reminder_message')) ||
    'Olá, {name}! 👋 Seu plano *{plan}* vence dia *{due_date}*. Quer renovar? 😊';

  const results = { sent: 0, skipped: 0, errors: [] };

  for (const client of clients) {
    const msg = renderTemplate(template, {
      name:     client.name,
      plan:     client.plan || 'seu plano',
      due_date: formatDate(client.due_date),
    });

    const whatsappId = client.phone.includes('@') ? client.phone : `${client.phone}@s.whatsapp.net`;

    try {
      await _sendMessage(whatsappId, msg);

      await db.run(
        `INSERT INTO renewal_notifications (client_id, due_date, status) VALUES (?, ?, 'sent')`,
        [client.id, client.due_date]
      );

      console.log(`[renewalReminder] Lembrete enviado para ${client.name} (${client.phone})`);
      results.sent++;
    } catch (err) {
      console.error(`[renewalReminder] Falhou ao enviar para ${client.name}:`, err.message);

      await db.run(
        `INSERT INTO renewal_notifications (client_id, due_date, status) VALUES (?, ?, 'failed')`,
        [client.id, client.due_date]
      );

      results.errors.push({ client: client.name, error: err.message });
    }
  }

  if (clients.length === 0) {
    console.log(`[renewalReminder] Nenhum cliente com vencimento em ${targetDate}.`);
  }

  return results;
}

/** Inicia o cron. Chamado no boot do server.js */
function startScheduler() {
  // Todo dia às 9h, horário de Brasília (TZ=America/Sao_Paulo no .env)
  cron.schedule('0 9 * * *', async () => {
    console.log('[renewalReminder] Executando verificação de vencimentos...');
    const r = await checkAndSend();
    console.log(`[renewalReminder] Resultado: ${r.sent} enviados, ${r.errors.length} erros.`);
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[renewalReminder] Cron ativo — verificação diária às 9h.');
}

module.exports = { startScheduler, checkAndSend, setSendMessage };
