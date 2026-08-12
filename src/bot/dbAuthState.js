'use strict';
/**
 * bot/dbAuthState.js — Sessão do WhatsApp (Baileys) persistida no Postgres
 *
 * Equivalente ao useMultiFileAuthState() da própria lib, mas guardando
 * credenciais e chaves do protocolo Signal no banco em vez de arquivos
 * locais. Necessário porque o Render (free tier) não tem disco persistente:
 * qualquer redeploy apagaria a sessão salva em arquivo, forçando escanear
 * o QR Code de novo toda vez que o código for atualizado.
 */

const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const db = require('../db/db');

const CREDS_KEY = 'whatsapp_creds';

async function useDbAuthState() {
  const storedCreds = await db.get('SELECT value FROM config WHERE key = ?', [CREDS_KEY]);
  const creds = storedCreds ? JSON.parse(storedCreds.value, BufferJSON.reviver) : initAuthCreds();

  const saveCreds = async () => {
    await db.run(
      `INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer)]
    );
  };

  const keys = {
    get: async (type, ids) => {
      const data = {};
      if (ids.length === 0) return data;

      const rows = await db.all(
        `SELECT key_id, value FROM whatsapp_keys WHERE type = ? AND key_id IN (${ids.map(() => '?').join(',')})`,
        [type, ...ids]
      );

      for (const row of rows) {
        let value = JSON.parse(row.value, BufferJSON.reviver);
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value);
        }
        data[row.key_id] = value;
      }
      return data;
    },

    set: async (data) => {
      for (const type in data) {
        for (const id in data[type]) {
          const value = data[type][id];
          if (value) {
            await db.run(
              `INSERT INTO whatsapp_keys (type, key_id, value) VALUES (?, ?, ?)
               ON CONFLICT (type, key_id) DO UPDATE SET value = EXCLUDED.value`,
              [type, id, JSON.stringify(value, BufferJSON.replacer)]
            );
          } else {
            await db.run('DELETE FROM whatsapp_keys WHERE type = ? AND key_id = ?', [type, id]);
          }
        }
      }
    },
  };

  return { state: { creds, keys }, saveCreds };
}

/** Apaga a sessão salva (usado em logout ou pra forçar um pareamento novo) */
async function clearDbAuthState() {
  await db.run('DELETE FROM config WHERE key = ?', [CREDS_KEY]);
  await db.run('DELETE FROM whatsapp_keys');
}

module.exports = { useDbAuthState, clearDbAuthState };
