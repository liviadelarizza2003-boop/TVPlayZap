'use strict';
/**
 * scheduler/trialFollowup.js
 *
 * Roda a cada 15 minutos. Verifica clientes em período de teste (is_trial=1)
 * cujo trial começou há 24h ou mais e que ainda não receberam a mensagem de
 * fim de trial, e envia perguntando se querem assinar o plano.
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

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

/** Verifica e envia mensagens de fim de trial. Chamável manualmente para testes. */
async function checkAndSend() {
  if (!_sendMessage) {
    console.warn('[trialFollowup] Função de envio ainda não registrada (bot desconectado?)');
    return { sent: 0, errors: [] };
  }

  const clients = await db.all(
    `SELECT * FROM clients
     WHERE is_trial = 1
       AND trial_message_sent = 0
       AND trial_started_at <= now() - interval '24 hours'`
  );

  const template = (await getConfigValue('trial_message')) ||
    'E aí, {name}! Seu período de teste de 24h terminou — gostou? Quer assinar o plano? 😊';

  const results = { sent: 0, errors: [] };

  for (const client of clients) {
    const msg = renderTemplate(template, { name: client.name, plan: client.plan || 'o plano' });
    const whatsappId = client.phone.includes('@') ? client.phone : `${client.phone}@s.whatsapp.net`;

    try {
      await _sendMessage(whatsappId, msg);

      await db.run('UPDATE clients SET trial_message_sent = 1 WHERE id = ?', [client.id]);
      await db.run(
        `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'trial_followup')`,
        [client.phone, msg]
      );

      console.log(`[trialFollowup] Mensagem de fim de trial enviada para ${client.name} (${client.phone})`);
      results.sent++;
    } catch (err) {
      console.error(`[trialFollowup] Falhou ao enviar para ${client.name}:`, err.message);
      results.errors.push({ client: client.name, error: err.message });
    }
  }

  return results;
}

/** Inicia o cron. Chamado no boot do server.js */
function startScheduler() {
  cron.schedule('*/15 * * * *', async () => {
    const r = await checkAndSend();
    if (r.sent > 0 || r.errors.length > 0) {
      console.log(`[trialFollowup] Resultado: ${r.sent} enviados, ${r.errors.length} erros.`);
    }
  });

  console.log('[trialFollowup] Cron ativo — verificação a cada 15 minutos.');
}

module.exports = { startScheduler, checkAndSend, setSendMessage };
