'use strict';
/**
 * bot/messageHandler.js
 *
 * Processa cada mensagem recebida do WhatsApp:
 *  1. Extrai texto da mensagem (suporte a diferentes tipos de envelope Baileys)
 *  2. Verifica se está dentro do horário de atendimento
 *  3. Busca no FAQ por similaridade (faqSearch.js)
 *  4. Se encontrar: responde automaticamente
 *  5. Se não encontrar: envia mensagem de fallback (chama a Livia)
 *  6. Grava no log de mensagens para análise futura
 */

const db           = require('../db/db');
const { search }   = require('../engine/faqSearch');

async function getConfigValue(key) {
  return (await db.get('SELECT value FROM config WHERE key = ?', [key]))?.value || '';
}

function getMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    ''
  );
}

async function isWorkingHours() {
  const start = parseInt((await getConfigValue('working_hours_start')) || '9');
  const end   = parseInt((await getConfigValue('working_hours_end'))   || '18');
  const now   = new Date();
  const hour  = now.getHours();
  return hour >= start && hour < end;
}

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] || '');
}

/**
 * Processa uma mensagem recebida.
 * @param {object} msg — objeto de mensagem do Baileys
 * @param {Function} sendMessage — função (jid, text) => Promise
 */
async function handleMessage(msg, sendMessage) {
  const jid  = msg.key.remoteJid;
  const text = getMessageText(msg).trim();

  // Ignora mensagens sem texto (stickers, contatos, etc.)
  if (!text) return;

  const phone = jid.replace('@s.whatsapp.net', '');

  // Grava mensagem inbound no log
  await db.run(
    `INSERT INTO messages_log (phone, direction, body) VALUES (?, 'inbound', ?)`,
    [phone, text]
  );

  // ── Fora do horário ────────────────────────────────────────────────────────
  if (!(await isWorkingHours())) {
    const startH = (await getConfigValue('working_hours_start')) || '9';
    const endH   = (await getConfigValue('working_hours_end'))   || '18';
    const offMsg = renderTemplate(
      (await getConfigValue('off_hours_message')) ||
        'Olá! Nosso horário de atendimento é das {start}h às {end}h. Em breve retornamos! 😊',
      { start: startH, end: endH }
    );

    await sendMessage(jid, offMsg);
    await db.run(
      `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'off_hours')`,
      [phone, offMsg]
    );
    return;
  }

  // ── Busca no FAQ ───────────────────────────────────────────────────────────
  const match = await search(text);

  if (match) {
    await sendMessage(jid, match.answer);
    await db.run(
      `INSERT INTO messages_log (phone, direction, body, answered_by, faq_id, confidence)
       VALUES (?, 'outbound', ?, 'faq', ?, ?)`,
      [phone, match.answer, match.faqId, match.confidence]
    );
    return;
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  const fallback = (await getConfigValue('fallback_message')) ||
    'Olá! 😊 Vou chamar a Lívia para você. Aguarde um momentinho!';

  await sendMessage(jid, fallback);
  await db.run(
    `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'fallback')`,
    [phone, fallback]
  );
}

module.exports = { handleMessage, getMessageText };
