'use strict';
/**
 * bot/historyIngest.js — Ingestão do histórico sincronizado pelo WhatsApp
 *
 * Quando um número é vinculado como dispositivo (QR Code), o WhatsApp
 * sincroniza parte das conversas antigas pro Baileys via o evento
 * 'messaging-history.set'. Aqui gravamos essas mensagens em messages_log,
 * na mesma tabela que já alimenta a análise de FAQ e a extração de clientes —
 * isso só acontece uma vez por vinculação (controlado pela flag
 * 'history_synced' em config).
 */

const { isJidBroadcast } = require('@whiskeysockets/baileys');
const db = require('../db/db');
const { getMessageText } = require('./messageHandler');

async function alreadySynced() {
  const row = await db.get("SELECT value FROM config WHERE key = 'history_synced'");
  return row?.value === 'true';
}

async function markSynced() {
  await db.run(
    "INSERT INTO config (key, value) VALUES ('history_synced', 'true') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
  );
}

/**
 * @param {object[]} messages — lote de mensagens antigas do evento 'messaging-history.set'
 * @param {boolean} isLatest — true no último lote da sincronização
 */
async function ingestHistory(messages, isLatest) {
  if (await alreadySynced()) return;

  let saved = 0;
  for (const msg of messages) {
    const jid = msg.key?.remoteJid;
    if (!jid || isJidBroadcast(jid) || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

    const text = getMessageText(msg).trim();
    if (!text) continue;

    const phone     = jid.replace('@s.whatsapp.net', '');
    const direction = msg.key.fromMe ? 'outbound' : 'inbound';
    const sentAt    = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
      : new Date().toISOString();

    await db.run(
      `INSERT INTO messages_log (phone, direction, body, answered_by, sent_at) VALUES (?, ?, ?, 'history', ?)`,
      [phone, direction, text, sentAt]
    );
    saved++;
  }

  if (saved > 0) {
    console.log(`[historyIngest] ${saved} mensagens do histórico gravadas neste lote.`);
  }

  if (isLatest) {
    await markSynced();
    console.log('[historyIngest] Sincronização de histórico do WhatsApp concluída.');
  }
}

module.exports = { ingestHistory };
