'use strict';
/**
 * scheduler/renewalReminder.js
 *
 * Lembra clientes cujo plano vence em exatamente 3 dias (e que ainda não
 * receberam o lembrete pra essa data de vencimento) pelo WhatsApp via Baileys.
 *
 * COMO RODA (mudou em 24/09/2026 — ver "Por que não é mais só às 9h" abaixo):
 *   - a cada 30 minutos, dentro da janela de envio (padrão 09:00–18:00,
 *     horário de Brasília), e
 *   - logo depois do WhatsApp conectar (bot/index.js chama `runIfDue()`).
 * Cada execução é idempotente: quem já recebeu o lembrete daquele vencimento
 * (`renewal_notifications`) é ignorado, então rodar várias vezes no dia é seguro.
 *
 * Por que não é mais só às 9h: o cron rodava só às 09:00 em ponto, dentro do
 * processo web. No Render Free o processo hiberna sem tráfego e, se estivesse
 * dormindo às 9h, aquele dia era PERDIDO — e como o lembrete mira só o
 * vencimento em exatamente 3 dias, no dia seguinte esse cliente já não
 * entrava mais. Medido em produção: em ~5 semanas, 41 dos 42 lembretes
 * registrados foram do botão manual "Lembrar"; só 1 foi automático. Agora um
 * processo que acorda atrasado (pinger, deploy, reconexão) ainda envia no
 * MESMO dia. Continua mirando só D+3 — nunca envia pra vencimento passado.
 *
 * Config (tabela `config`, editável, sem mexer em código):
 *   reminder_send_start_hour  (padrão 9)   — não envia antes dessa hora
 *   reminder_send_end_hour    (padrão 18)  — não envia a partir dessa hora
 */

const cron = require('node-cron');
const db   = require('../db/db');

const TIMEZONE            = 'America/Sao_Paulo';
const DAYS_AHEAD          = 3;
const DEFAULT_START_HOUR  = 9;
const DEFAULT_END_HOUR    = 18;
// Falha de envio é registrada como 'failed' e tentada de novo na próxima
// execução (a cada 30 min) — sem teto, um número inválido seria tentado o dia
// todo. Depois disso só o botão manual "Lembrar" reenvia.
const MAX_FAILED_ATTEMPTS = 3;

let _sendMessage = null; // injetado pelo bot/index.js
let _isConnected = null; // injetado pelo bot/index.js — () => boolean
let _running     = false; // impede duas execuções simultâneas (cron + conexão)

/** Registra a função de envio do Baileys */
function setSendMessage(fn) {
  _sendMessage = fn;
}

/** Registra como saber se o WhatsApp está conectado agora */
function setIsConnected(fn) {
  _isConnected = fn;
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

/** Data e hora de `now` no fuso de Brasília (independe do TZ do servidor). */
function saoPauloParts(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) };
}

/**
 * Data (YYYY-MM-DD) de "hoje + N dias" no fuso de Brasília. O código antigo
 * usava `toISOString()` (UTC): depois das 21h de Brasília o "hoje" em UTC já é
 * o dia seguinte, e o alvo do lembrete pulava um dia.
 */
function saoPauloDatePlus(now, days) {
  const [y, m, d] = saoPauloParts(now).date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `now` está dentro de [startHour, endHour) no horário de Brasília? */
function isWithinSendWindow(now, startHour, endHour) {
  const { hour } = saoPauloParts(now);
  return hour >= startHour && hour < endHour;
}

function parseHour(raw, fallback) {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n <= 24 ? n : fallback;
}

/**
 * Verifica e envia lembretes. Chamável manualmente para testes. NÃO checa a
 * janela de horário (quem decide isso é `runIfDue`) — só o alvo D+3, o
 * WhatsApp conectado e o que já foi enviado.
 */
async function checkAndSend({ now = new Date() } = {}) {
  if (!_sendMessage) {
    console.warn('[renewalReminder] Função de envio ainda não registrada (bot desconectado?)');
    return { sent: 0, skipped: 0, errors: [] };
  }

  // WhatsApp fora do ar: não tenta, e principalmente não grava 'failed' —
  // uma queda de conexão não é culpa do cliente e não pode gastar as
  // tentativas dele (MAX_FAILED_ATTEMPTS). A próxima execução tenta de novo.
  if (_isConnected && !_isConnected()) {
    console.log('[renewalReminder] WhatsApp desconectado — verificação adiada.');
    return { sent: 0, skipped: 0, errors: [], offline: true };
  }

  const targetDate = saoPauloDatePlus(now, DAYS_AHEAD);

  // Clientes com vencimento em 3 dias que ainda não receberam lembrete para esta data
  const candidates = await db.all(
    `SELECT c.*,
            (SELECT COUNT(*) FROM renewal_notifications f
              WHERE f.client_id = c.id AND f.due_date = c.due_date AND f.status = 'failed') AS failed_count
     FROM clients c
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

  for (const client of candidates) {
    if (parseInt(client.failed_count, 10) >= MAX_FAILED_ATTEMPTS) {
      results.skipped++;
      continue;
    }

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
      // A conexão caiu no meio do lote: para aqui, sem gravar 'failed' (ver acima).
      if (_isConnected && !_isConnected()) {
        console.log('[renewalReminder] WhatsApp caiu durante o envio — restante adiado.');
        results.offline = true;
        break;
      }

      console.error(`[renewalReminder] Falhou ao enviar para ${client.name}:`, err.message);

      await db.run(
        `INSERT INTO renewal_notifications (client_id, due_date, status) VALUES (?, ?, 'failed')`,
        [client.id, client.due_date]
      );

      results.errors.push({ client: client.name, error: err.message });
    }
  }

  return results;
}

/**
 * Ponto de entrada do cron e da conexão do WhatsApp: só envia dentro da janela
 * de horário e nunca duas execuções ao mesmo tempo (o cron de 30 min e o
 * evento de "WhatsApp conectou" podem coincidir — sem a trava, os dois leriam
 * "ainda não enviado" antes de qualquer um gravar e o cliente receberia o
 * lembrete em dobro).
 */
async function runIfDue({ now = new Date() } = {}) {
  if (_running) return { skipped: 'busy' };
  _running = true;
  try {
    const start = parseHour(await getConfigValue('reminder_send_start_hour'), DEFAULT_START_HOUR);
    let   end   = parseHour(await getConfigValue('reminder_send_end_hour'),   DEFAULT_END_HOUR);
    if (end <= start) end = DEFAULT_END_HOUR; // configuração incoerente: volta ao padrão

    if (!isWithinSendWindow(now, start, end)) return { skipped: 'outside_window' };

    const r = await checkAndSend({ now });
    if (r.sent > 0 || r.errors.length > 0) {
      console.log(`[renewalReminder] Resultado: ${r.sent} enviados, ${r.errors.length} erros.`);
    }
    return r;
  } finally {
    _running = false;
  }
}

/** Inicia o cron. Chamado no boot do server.js */
function startScheduler() {
  // A cada 30 min, o dia todo — `runIfDue` decide pela janela de envio (config).
  cron.schedule('*/30 * * * *', () => {
    runIfDue().catch(err => console.error('[renewalReminder] Erro na verificação:', err));
  }, { timezone: TIMEZONE });

  console.log('[renewalReminder] Cron ativo — verificação a cada 30 min na janela de envio (padrão 9h–18h) e ao conectar o WhatsApp.');
}

module.exports = {
  startScheduler, checkAndSend, runIfDue, setSendMessage, setIsConnected,
  saoPauloDatePlus, isWithinSendWindow, MAX_FAILED_ATTEMPTS,
};
