'use strict';
/**
 * bot/lidReconcile.js — Corrige registros salvos com "@lid" em vez do telefone
 *
 * Mensagens/candidatos gravados antes de resolvermos o LID pro número real
 * (ou casos em que o mapeamento ainda não estava disponível na hora) ficam
 * com o telefone errado no banco. Toda vez que o WhatsApp conecta, tentamos
 * de novo — o mapeamento LID↔telefone do Baileys vai enchendo com o tempo,
 * então rodar de novo a cada conexão tem chance de resolver mais casos.
 */

const { jidNormalizedUser } = require('@whiskeysockets/baileys');
const db = require('../db/db');

async function reconcileLidPhones(sock) {
  const lidMapping = sock?.signalRepository?.lidMapping;
  if (!lidMapping) return;

  const rows = await db.all(
    `SELECT DISTINCT phone FROM messages_log WHERE phone LIKE '%@lid'
     UNION
     SELECT DISTINCT phone FROM client_candidates WHERE phone LIKE '%@lid'
     UNION
     SELECT DISTINCT phone FROM human_pauses WHERE phone LIKE '%@lid'`
  );

  if (rows.length === 0) return;

  let fixed = 0;
  for (const { phone: lidJid } of rows) {
    try {
      const pn = await lidMapping.getPNForLID(lidJid);
      if (!pn) continue;

      // jidNormalizedUser remove o sufixo de dispositivo (ex: ":0") — sem isso
      // a mensagem parece "enviada" mas vai pro aparelho errado e não chega
      const realPhone = jidNormalizedUser(pn).replace('@s.whatsapp.net', '');
      await db.run('UPDATE messages_log SET phone = ? WHERE phone = ?', [realPhone, lidJid]);
      await db.run('UPDATE client_candidates SET phone = ? WHERE phone = ?', [realPhone, lidJid]);
      // human_pauses.phone é chave primária — se o telefone real já tiver uma
      // pausa própria, não dá pra ter duas linhas com a mesma PK depois do
      // UPDATE; nesse caso descarta a linha do @lid (a pausa do telefone real,
      // se existir, já é a que vale) em vez de deixar o UPDATE falhar.
      const existingPause = await db.get('SELECT 1 FROM human_pauses WHERE phone = ?', [realPhone]);
      if (existingPause) {
        await db.run('DELETE FROM human_pauses WHERE phone = ?', [lidJid]);
      } else {
        await db.run('UPDATE human_pauses SET phone = ? WHERE phone = ?', [realPhone, lidJid]);
      }
      fixed++;
    } catch (err) {
      console.error(`[lidReconcile] Falhou ao resolver ${lidJid}:`, err.message);
    }
  }

  if (fixed > 0) {
    console.log(`[lidReconcile] ${fixed}/${rows.length} telefones @lid corrigidos.`);
  }
}

module.exports = { reconcileLidPhones };
