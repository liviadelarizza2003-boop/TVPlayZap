'use strict';
/**
 * Testes de `src/scheduler/renewalReminder.js` — roda com
 * `node test/renewalReminder.js` (ou `npm test`).
 *
 * Contexto (24/09/2026): o lembrete de vencimento rodava só às 09:00 em ponto,
 * dentro do processo web. No Render Free o processo hiberna; se estivesse
 * dormindo às 9h, o dia era perdido — e como o lembrete mira só o vencimento
 * em exatamente 3 dias, no dia seguinte o cliente já não entrava. Medido em
 * produção: 41 dos 42 lembretes eram do botão manual, só 1 automático.
 *
 * O banco é um fake em memória (mesma técnica de test/messageHandlerTurns.js):
 * o fake reproduz em JS o filtro do SELECT (alvo D+3, ainda sem 'sent'), então
 * estes testes provam a LÓGICA em volta (janela, catch-up, trava, tentativas,
 * fuso), não o SQL em si — o SQL foi conferido à parte contra o Postgres real,
 * só leitura.
 */

const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

const fakeRegistry = new Map();
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (fakeRegistry.has(request)) return fakeRegistry.get(request);
  return originalResolveFilename.call(this, request, ...rest);
};
function registerFake(request, exportsObj) {
  const fakePath = path.join(__dirname, `__fake__${request.replace(/[^a-z0-9]/gi, '_')}.js`);
  fakeRegistry.set(request, fakePath);
  require.cache[fakePath] = { id: fakePath, filename: fakePath, loaded: true, exports: exportsObj };
}

// ---------------------------------------------------------------------------
// Estado em memória
// ---------------------------------------------------------------------------
const state = {
  clients: [],        // { id, name, phone, plan, due_date, is_active }
  notifications: [],  // { client_id, due_date, status }
  config: {},
  targetDatesQueried: [],
  scheduled: [],      // chamadas a cron.schedule
};

registerFake('node-cron', {
  schedule(expr, fn, opts) { state.scheduled.push({ expr, fn, opts }); },
});

registerFake('../db/db', {
  async get(sql, params = []) {
    if (sql.includes('FROM config')) {
      return Object.prototype.hasOwnProperty.call(state.config, params[0]) ? { value: state.config[params[0]] } : null;
    }
    return null;
  },
  async all(sql, params = []) {
    if (sql.includes('FROM clients')) {
      const targetDate = params[0];
      state.targetDatesQueried.push(targetDate);
      // Reproduz o filtro do SELECT: vencimento == alvo, ativo, sem 'sent' pra
      // essa data; devolve failed_count como a subquery real.
      return state.clients
        .filter(c => c.due_date === targetDate && c.is_active === 1)
        .filter(c => !state.notifications.some(n => n.client_id === c.id && n.due_date === targetDate && n.status === 'sent'))
        .map(c => ({
          ...c,
          failed_count: String(state.notifications.filter(n => n.client_id === c.id && n.due_date === c.due_date && n.status === 'failed').length),
        }));
    }
    return [];
  },
  async run(sql, params = []) {
    if (sql.includes('INSERT INTO renewal_notifications')) {
      const status = sql.includes("'failed'") ? 'failed' : 'sent';
      state.notifications.push({ client_id: params[0], due_date: params[1], status });
    }
    return { rows: [] };
  },
});

const reminder = require(path.join(__dirname, '../src/scheduler/renewalReminder.js'));

// Horário de Brasília = UTC-3 o ano todo (sem horário de verão desde 2019).
const brt = (date, hour, minute = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + 3, minute)); // Date.UTC aceita hora > 23 (vira o dia)
};

let sentMessages = [];
let connected = true;
let sendImpl = null;

function resetState() {
  state.clients = [];
  state.notifications = [];
  state.config = {};
  state.targetDatesQueried = [];
  sentMessages = [];
  connected = true;
  sendImpl = async (jid, text) => { sentMessages.push({ jid, text }); };
  reminder.setSendMessage((jid, text) => sendImpl(jid, text));
  reminder.setIsConnected(() => connected);
}

const client = (id, due_date, extra = {}) =>
  ({ id, name: `Cliente ${id}`, phone: `55119990000${id}`, plan: 'Mensal', due_date, is_active: 1, ...extra });

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.log(`  ✗ ${name}`); console.log(`    ${err.message}`); }
}

(async () => {
  // -------------------------------------------------------------------------
  console.log('\nfuso e janela de horário (Brasília)');

  await test('alvo é hoje+3 no fuso de Brasília, também depois das 21h (quando UTC já virou o dia)', () => {
    // 22:00 BRT de 24/09 = 01:00 UTC de 25/09. O código antigo (toISOString)
    // mirava 28/09; o certo é 27/09.
    assert.equal(reminder.saoPauloDatePlus(brt('2026-09-24', 22), 3), '2026-09-27');
    assert.equal(reminder.saoPauloDatePlus(brt('2026-09-24', 9), 3), '2026-09-27');
  });

  await test('alvo atravessa virada de mês e de ano', () => {
    assert.equal(reminder.saoPauloDatePlus(brt('2026-09-29', 10), 3), '2026-10-02');
    assert.equal(reminder.saoPauloDatePlus(brt('2026-12-30', 10), 3), '2027-01-02');
  });

  await test('janela [9, 18): 08:59 fora, 09:00 dentro, 17:59 dentro, 18:00 fora', () => {
    assert.equal(reminder.isWithinSendWindow(brt('2026-09-24', 8, 59), 9, 18), false);
    assert.equal(reminder.isWithinSendWindow(brt('2026-09-24', 9, 0), 9, 18), true);
    assert.equal(reminder.isWithinSendWindow(brt('2026-09-24', 17, 59), 9, 18), true);
    assert.equal(reminder.isWithinSendWindow(brt('2026-09-24', 18, 0), 9, 18), false);
  });

  // -------------------------------------------------------------------------
  console.log('\nrunIfDue() — o bug: processo acordou depois das 9h');

  await test('CATCH-UP: acordou às 10:30 (cron das 9h perdido) e AINDA envia no mesmo dia', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    const r = await reminder.runIfDue({ now: brt('2026-09-24', 10, 30) });
    assert.equal(r.sent, 1);
    assert.equal(sentMessages.length, 1);
    assert.ok(sentMessages[0].jid.endsWith('@s.whatsapp.net'));
    assert.deepEqual(state.notifications, [{ client_id: 6, due_date: '2026-09-27', status: 'sent' }]);
  });

  await test('rodar de novo no mesmo dia NÃO duplica o lembrete (idempotente)', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    await reminder.runIfDue({ now: brt('2026-09-24', 10, 0) });
    await reminder.runIfDue({ now: brt('2026-09-24', 10, 30) });
    await reminder.runIfDue({ now: brt('2026-09-24', 15, 0) });
    assert.equal(sentMessages.length, 1);
  });

  await test('NUNCA envia pra vencimento fora de D+3 (hoje, amanhã, depois de amanhã, passado)', async () => {
    resetState();
    state.clients = [
      client(1, '2026-09-20'), // vencido há dias
      client(2, '2026-09-24'), // vence hoje
      client(3, '2026-09-25'), // amanhã
      client(4, '2026-09-26'), // depois de amanhã
      client(5, '2026-09-28'), // D+4
    ];
    const r = await reminder.runIfDue({ now: brt('2026-09-24', 10, 0) });
    assert.equal(r.sent, 0);
    assert.equal(sentMessages.length, 0, `não devia enviar nada, enviou: ${JSON.stringify(sentMessages)}`);
  });

  await test('fora da janela (08:00 e 19:00) não envia nem consulta clientes', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    for (const hour of [0, 7, 8, 18, 19, 23]) {
      const r = await reminder.runIfDue({ now: brt('2026-09-24', hour) });
      assert.equal(r.skipped, 'outside_window', `hora ${hour}`);
    }
    assert.equal(sentMessages.length, 0);
    assert.equal(state.targetDatesQueried.length, 0);
  });

  await test('janela vem da config (reminder_send_start_hour / reminder_send_end_hour)', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    state.config = { reminder_send_start_hour: '11', reminder_send_end_hour: '14' };
    assert.equal((await reminder.runIfDue({ now: brt('2026-09-24', 10) })).skipped, 'outside_window');
    assert.equal((await reminder.runIfDue({ now: brt('2026-09-24', 12) })).sent, 1);
  });

  await test('config incoerente (fim <= início, ou lixo) volta ao padrão 9h–18h em vez de travar tudo', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    state.config = { reminder_send_start_hour: '15', reminder_send_end_hour: '10' };
    // fim <= início → fim volta a 18; início 15 continua valendo
    assert.equal((await reminder.runIfDue({ now: brt('2026-09-24', 12) })).skipped, 'outside_window');
    assert.equal((await reminder.runIfDue({ now: brt('2026-09-24', 16) })).sent, 1);
    resetState();
    state.clients = [client(6, '2026-09-27')];
    state.config = { reminder_send_start_hour: 'abc', reminder_send_end_hour: '' };
    assert.equal((await reminder.runIfDue({ now: brt('2026-09-24', 10) })).sent, 1);
  });

  // -------------------------------------------------------------------------
  console.log('\nrunIfDue() — proteções');

  await test('cron e "WhatsApp conectou" ao mesmo tempo: só UMA execução envia (sem lembrete em dobro)', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    sendImpl = async (jid, text) => { await new Promise(r => setTimeout(r, 40)); sentMessages.push({ jid, text }); };
    const now = brt('2026-09-24', 10, 0);
    const [a, b] = await Promise.all([reminder.runIfDue({ now }), reminder.runIfDue({ now })]);
    assert.equal(sentMessages.length, 1, `esperava 1 envio, houve ${sentMessages.length}`);
    const skipped = [a, b].filter(r => r.skipped === 'busy');
    assert.equal(skipped.length, 1, 'a segunda execução devia ser descartada como ocupada');
  });

  await test('trava é liberada mesmo se o envio falhar (a próxima execução não fica presa)', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    sendImpl = async () => { throw new Error('falha qualquer'); };
    await reminder.runIfDue({ now: brt('2026-09-24', 10, 0) });
    sendImpl = async (jid, text) => { sentMessages.push({ jid, text }); };
    const r = await reminder.runIfDue({ now: brt('2026-09-24', 10, 30) });
    assert.notEqual(r.skipped, 'busy');
    assert.equal(r.sent, 1);
  });

  await test('WhatsApp desconectado: não tenta, não grava "failed" e não gasta tentativas', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    connected = false;
    const r = await reminder.runIfDue({ now: brt('2026-09-24', 10, 0) });
    assert.equal(r.offline, true);
    assert.equal(sentMessages.length, 0);
    assert.equal(state.notifications.length, 0, 'queda de conexão não pode virar "failed" do cliente');
    // Reconectou → próxima execução envia normalmente.
    connected = true;
    assert.equal((await reminder.runIfDue({ now: brt('2026-09-24', 10, 30) })).sent, 1);
  });

  await test('conexão cai NO MEIO do lote: para, não grava "failed", e o restante sai na próxima', async () => {
    resetState();
    state.clients = [client(1, '2026-09-27'), client(2, '2026-09-27')];
    let calls = 0;
    sendImpl = async (jid, text) => {
      calls++;
      if (calls === 2) { connected = false; throw new Error('Bot não conectado ao WhatsApp'); }
      sentMessages.push({ jid, text });
    };
    const r1 = await reminder.runIfDue({ now: brt('2026-09-24', 10, 0) });
    assert.equal(r1.sent, 1);
    assert.equal(state.notifications.filter(n => n.status === 'failed').length, 0);
    connected = true;
    sendImpl = async (jid, text) => { sentMessages.push({ jid, text }); };
    const r2 = await reminder.runIfDue({ now: brt('2026-09-24', 10, 30) });
    assert.equal(r2.sent, 1);
    assert.equal(sentMessages.length, 2, 'cada cliente recebeu exatamente 1 lembrete');
  });

  await test(`falha real de envio: repete nas próximas execuções, mas desiste após ${reminder.MAX_FAILED_ATTEMPTS} tentativas`, async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    let attempts = 0;
    sendImpl = async () => { attempts++; throw new Error('número inválido'); };
    for (let i = 0; i < 6; i++) await reminder.runIfDue({ now: brt('2026-09-24', 10, i * 5) });
    assert.equal(attempts, reminder.MAX_FAILED_ATTEMPTS, `tentou ${attempts} vezes`);
    assert.equal(state.notifications.filter(n => n.status === 'failed').length, reminder.MAX_FAILED_ATTEMPTS);
  });

  await test('sem função de envio registrada (bot nunca subiu): não quebra e não grava nada', async () => {
    resetState();
    state.clients = [client(6, '2026-09-27')];
    reminder.setSendMessage(null);
    const r = await reminder.runIfDue({ now: brt('2026-09-24', 10, 0) });
    assert.equal(r.sent, 0);
    assert.equal(state.notifications.length, 0);
  });

  // -------------------------------------------------------------------------
  console.log('\nstartScheduler() — agenda de verdade');

  await test('registra o cron a cada 30 min (o dia todo), no fuso de Brasília, e ele dispara runIfDue', async () => {
    resetState();
    state.scheduled.length = 0;
    reminder.startScheduler();
    assert.equal(state.scheduled.length, 1);
    assert.equal(state.scheduled[0].expr, '*/30 * * * *');
    assert.equal(state.scheduled[0].opts.timezone, 'America/Sao_Paulo');
    // O callback não pode lançar (roda solto dentro do node-cron).
    assert.doesNotThrow(() => state.scheduled[0].fn());
    await new Promise(r => setTimeout(r, 20));
  });

  console.log(`\n${passed} passou, ${failed} falhou.`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
