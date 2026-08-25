'use strict';
/**
 * bot/messageHandler.js
 *
 * Processa cada mensagem recebida do WhatsApp:
 *  1. Extrai texto da mensagem (suporte a diferentes tipos de envelope Baileys)
 *  2. Agrupa mensagens seguidas do mesmo cliente (debounce) antes de responder
 *  3. Verifica se há atendimento humano em andamento (pausa automática)
 *  4. Verifica se está dentro do horário de atendimento
 *  5. Busca no FAQ por similaridade (faqSearch.js)
 *  6. Se encontrar: responde automaticamente
 *  7. Se não encontrar: envia mensagem de fallback (chama a Livia)
 *  8. Grava no log de mensagens para análise futura
 *
 * Também trata mensagens enviadas pelo próprio número (fromMe): distingue o
 * eco do que o próprio bot mandou (ignora) de uma resposta manual de verdade
 * (celular/WhatsApp Web) — nesse caso, pausa as respostas automáticas desse
 * cliente por um tempo (ver setHumanPause), pra não competir com quem já
 * está atendendo ao vivo.
 */

const db           = require('../db/db');
const { search }   = require('../engine/faqSearch');
const { resolvePhone } = require('./jidUtils');

const DEBOUNCE_DEFAULT_SECONDS   = 15;
const HUMAN_PAUSE_DEFAULT_HOURS  = 6;
const DEDUPE_DEFAULT_HOURS       = 3;
const PRESENCE_REFRESH_MS        = 5000; // WhatsApp "digitando..." expira sozinho depois de alguns segundos

// phone -> { texts: string[], jid: string, timer: Timeout, presenceTimer: Interval }
const pendingBuffers = new Map();

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

/** Uma resposta automática do mesmo tipo já foi mandada recentemente pra esse telefone? */
async function wasRecentlySent(phone, answeredBy) {
  const hours = parseFloat((await getConfigValue('auto_reply_dedupe_hours')) || String(DEDUPE_DEFAULT_HOURS));
  const row = await db.get(
    `SELECT id FROM messages_log
     WHERE phone = ? AND direction = 'outbound' AND answered_by = ?
       AND sent_at > now() - (interval '1 hour' * ?)
     LIMIT 1`,
    [phone, answeredBy, hours]
  );
  return !!row;
}

/** Existe pausa ativa (atendimento humano em andamento) pra esse telefone? */
async function isHumanPaused(phone) {
  const row = await db.get('SELECT paused_until FROM human_pauses WHERE phone = ?', [phone]);
  return !!(row && new Date(row.paused_until) > new Date());
}

/** Cria/renova a pausa automática pra esse telefone a partir de agora */
async function setHumanPause(phone) {
  const hours = parseFloat((await getConfigValue('human_pause_hours')) || String(HUMAN_PAUSE_DEFAULT_HOURS));
  await db.run(
    `INSERT INTO human_pauses (phone, paused_until, updated_at)
     VALUES (?, now() + (interval '1 hour' * ?), now())
     ON CONFLICT (phone) DO UPDATE SET paused_until = EXCLUDED.paused_until, updated_at = now()`,
    [phone, hours]
  );
}

function updatePresence(sock, jid) {
  if (!sock) return;
  sock.sendPresenceUpdate('composing', jid).catch(() => { /* melhor esforço, não crítico */ });
}

function clearBuffer(phone) {
  const entry = pendingBuffers.get(phone);
  if (!entry) return;
  clearTimeout(entry.timer);
  if (entry.presenceTimer) clearInterval(entry.presenceTimer);
  pendingBuffers.delete(phone);
}

/**
 * Agrupa mensagens seguidas do mesmo cliente por alguns segundos antes de
 * responder — evita que 2-3 balõezinhos digitados em sequência (comum no
 * WhatsApp) disparem 2-3 respostas automáticas separadas, uma atropelando a
 * outra. Mostra "digitando..." enquanto espera.
 */
async function bufferMessage(phone, jid, text, sendMessage, sock) {
  const delayMs = parseFloat((await getConfigValue('debounce_seconds')) || String(DEBOUNCE_DEFAULT_SECONDS)) * 1000;

  let entry = pendingBuffers.get(phone);
  if (!entry) {
    entry = { texts: [], jid };
    pendingBuffers.set(phone, entry);
    updatePresence(sock, jid);
    entry.presenceTimer = setInterval(() => updatePresence(sock, jid), PRESENCE_REFRESH_MS);
  }

  entry.texts.push(text);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    const combined = entry.texts.join('\n');
    clearBuffer(phone);
    respondToMessage(phone, jid, combined, sendMessage).catch(err =>
      console.error('[bot] Erro ao responder mensagem agrupada:', err)
    );
  }, delayMs);
}

/** Pipeline de resposta automática de verdade (identidade → horário → FAQ → fallback) */
async function respondToMessage(phone, jid, text, sendMessage) {
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
    if (await wasRecentlySent(phone, 'off_hours')) return; // já avisou recentemente, não repete a cada mensagem

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
  if (await wasRecentlySent(phone, 'fallback')) return; // já chamou a Lívia recentemente, não repete a cada mensagem

  const fallback = (await getConfigValue('fallback_message')) ||
    'Olá! 😊 Vou chamar a Lívia para você. Aguarde um momentinho!';

  await sendMessage(jid, fallback);
  await db.run(
    `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'fallback')`,
    [phone, fallback]
  );
}

/**
 * Processa uma mensagem recebida de um cliente (não enviada por nós).
 * @param {object} msg — objeto de mensagem do Baileys
 * @param {Function} sendMessage — função (jid, text) => Promise
 * @param {object} [sock] — socket do Baileys (usado pra resolver telefone/typing)
 */
async function handleMessage(msg, sendMessage, sock) {
  const jid  = msg.key.remoteJid;
  const text = getMessageText(msg).trim();

  // Ignora mensagens sem texto (stickers, contatos, etc.)
  if (!text) return;

  const phone = await resolvePhone(jid, msg.key, sock);

  // Grava mensagem inbound no log (sempre, independente de responder ou não)
  await db.run(
    `INSERT INTO messages_log (phone, direction, body) VALUES (?, 'inbound', ?)`,
    [phone, text]
  );

  // Alguém já está atendendo esse cliente ao vivo — não compete com isso
  if (await isHumanPaused(phone)) return;

  await bufferMessage(phone, jid, text, sendMessage, sock);
}

/**
 * Processa uma mensagem com `fromMe = true` (enviada pelo próprio número).
 * Se o id já é conhecido (o bot acabou de mandar via sendMessage), é só o eco
 * do próprio envio — ignora. Caso contrário, é uma resposta manual de verdade
 * (celular/WhatsApp Web) — loga e pausa as respostas automáticas desse cliente.
 * @param {object} msg
 * @param {Set<string>} sentIds — ids de mensagens que o próprio bot acabou de enviar (ver bot/index.js)
 * @param {object} [sock]
 */
async function handleOwnMessage(msg, sentIds, sock) {
  const id = msg.key.id;
  if (id && sentIds.has(id)) {
    sentIds.delete(id);
    return;
  }

  const jid  = msg.key.remoteJid;
  const text = getMessageText(msg).trim();
  const phone = await resolvePhone(jid, msg.key, sock);

  if (text) {
    await db.run(
      `INSERT INTO messages_log (phone, direction, body, answered_by) VALUES (?, 'outbound', ?, 'human_manual')`,
      [phone, text]
    );
  }

  await setHumanPause(phone);

  // Cancela qualquer resposta automática que já estivesse "no forno" pra esse cliente
  clearBuffer(phone);
}

module.exports = { handleMessage, handleOwnMessage, getMessageText };
