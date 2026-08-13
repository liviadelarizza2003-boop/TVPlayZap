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
const { resolvePhone } = require('./jidUtils');

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

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Palavras isoladas que já indicam a pergunta ("você é um robô?", "isso é bot?")
const IDENTITY_WORDS = ['robo', 'robozinho', 'bot', 'chatbot', 'automatico', 'automatizado', 'maquina'];

// Frases (checadas como substring com espaços nas pontas, pra evitar falso positivo
// com "ia" isolado — que em português também é o pretérito de "ir": "eu ia pagar...")
const IDENTITY_PHRASES = [
  ' inteligencia artificial ', ' e ia ', ' e uma ia ', ' voce e ia ', ' vc e ia ',
  ' voce e uma ia ', ' vc e uma ia ', ' sao ia ', ' sao uma ia ',
  ' pessoa real ', ' humano de verdade ', ' gente de verdade ', ' atendente de verdade ',
  ' falando com humano ', ' falando com uma pessoa ', ' e humano ', ' voce e humano ', ' vc e humano ',
];

/** Detecta se a mensagem está perguntando se está falando com uma IA/robô/humano */
function looksLikeIdentityQuestion(text) {
  const tokens = normalize(text).split(' ').filter(Boolean);
  if (tokens.some(t => IDENTITY_WORDS.includes(t))) return true;

  const padded = ` ${tokens.join(' ')} `;
  return IDENTITY_PHRASES.some(phrase => padded.includes(phrase));
}

/**
 * Processa uma mensagem recebida.
 * @param {object} msg — objeto de mensagem do Baileys
 * @param {Function} sendMessage — função (jid, text) => Promise
 * @param {object} [sock] — socket do Baileys (usado pra resolver telefone de contatos @lid)
 */
async function handleMessage(msg, sendMessage, sock) {
  const jid  = msg.key.remoteJid;
  const text = getMessageText(msg).trim();

  // Ignora mensagens sem texto (stickers, contatos, etc.)
  if (!text) return;

  const phone = await resolvePhone(jid, msg.key, sock);

  // Grava mensagem inbound no log
  await db.run(
    `INSERT INTO messages_log (phone, direction, body) VALUES (?, 'inbound', ?)`,
    [phone, text]
  );

  // ── "Você é uma IA?" ──────────────────────────────────────────────────────
  if (looksLikeIdentityQuestion(text)) {
    const disclosure = (await getConfigValue('ai_disclosure_message')) ||
      'Sou a Eva, assistente virtual da TV Play! 😊';

    await sendMessage(jid, disclosure);
    await db.run(
      `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'ai_disclosure')`,
      [phone, disclosure]
    );
    return;
  }

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
