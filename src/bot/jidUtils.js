'use strict';
/**
 * bot/jidUtils.js — Resolução de telefone real a partir do JID do WhatsApp
 *
 * O WhatsApp vem endereçando parte dos contatos por "@lid" (Linked ID,
 * identificador interno sem relação direta com o número) em vez do
 * tradicional "<telefone>@s.whatsapp.net". Aqui traduzimos de volta pro
 * telefone real usando o campo alternativo da própria mensagem ou,
 * como fallback, o mapeamento LID↔telefone do Baileys.
 *
 * Importante: um JID de telefone pode vir com um sufixo de dispositivo
 * (ex: "5511999998888:0@s.whatsapp.net", endereçando um aparelho específico
 * daquele número). Guardar esse sufixo como se fosse o telefone faz o envio
 * ir pro dispositivo errado — a mensagem "sai" (não dá erro) mas nunca chega
 * no cliente. `jidNormalizedUser` remove esse sufixo corretamente.
 */

const { jidNormalizedUser } = require('@whiskeysockets/baileys');

/**
 * @param {string} jid — msg.key.remoteJid
 * @param {object} [key] — msg.key (pode conter remoteJidAlt)
 * @param {object} [sock] — socket do Baileys, usado pro fallback assíncrono
 * @returns {Promise<string>} telefone (só dígitos) ou, na pior hipótese, o próprio identificador
 */
async function resolvePhone(jid, key, sock) {
  if (!jid) return jid;

  if (jid.endsWith('@s.whatsapp.net')) {
    return jidNormalizedUser(jid).replace('@s.whatsapp.net', '');
  }

  if (jid.endsWith('@lid')) {
    const alt = key?.remoteJidAlt;
    if (alt?.endsWith('@s.whatsapp.net')) {
      return jidNormalizedUser(alt).replace('@s.whatsapp.net', '');
    }

    try {
      const pn = await sock?.signalRepository?.lidMapping?.getPNForLID(jid);
      if (pn) return jidNormalizedUser(pn).replace('@s.whatsapp.net', '');
    } catch { /* segue pro fallback abaixo */ }

    // Não foi possível resolver ainda — usa o LID sem sufixo (melhor que travar)
    return jid.replace('@lid', '');
  }

  return jid.replace(/@.*/, '');
}

module.exports = { resolvePhone };
