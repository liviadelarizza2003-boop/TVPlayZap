'use strict';
/**
 * Suíte de regressão de `src/bot/messageHandler.js` — roda com
 * `node test/messageHandlerTurns.js` (ou `npm test`). Arquivo próprio
 * (processo separado de `test/regression.js`) porque o mock de `../db/db`
 * aqui precisa simular um `INSERT` lento pra reproduzir a race condition,
 * o que ficaria confuso misturado com o fake simples da primeira suíte.
 *
 * Portada da mesma suíte da Eva "grande"
 * (`C:\Sistemas\eva-test\test\messageHandlerTurns.js`, 26/08/2026) — lá o
 * bug era em `respondToConversation()` (serializado por `conversation_id`,
 * já que a Eva tem tabela `conversations`); aqui o mesmo tipo de race existe
 * em `respondToMessage()`, serializado por telefone direto (esta Eva Lite
 * não tem `conversations`, `wasRecentlySent()` sempre foi escopada por
 * `phone`).
 *
 * Cobre: duas rajadas do mesmo cliente espaçadas mais que `debounce_seconds`
 * (cada uma dispara seu próprio timer em `bufferMessage`) rodando ao mesmo
 * tempo — sem serialização por telefone, o segundo turno lia
 * `wasRecentlySent()` antes do primeiro terminar de gravar sua resposta no
 * banco, e os dois mandavam a mesma mensagem de fallback pro cliente.
 *
 * Como adicionar um caso: copiar um bloco `await test('...', async () => {...})`
 * existente e ajustar o cenário.
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

const state = { config: {}, log: [], pauses: [] };
let dbWriteDelayMs = 0;

registerFake('../db/db', {
  async get(sql, params) {
    if (sql.includes('FROM config')) return { value: state.config[params[0]] };
    if (sql.includes('FROM messages_log') && sql.includes('answered_by = ?')) {
      const found = state.log.some(l => l.phone === params[0] && l.answered_by === params[1]);
      return found ? { id: 1 } : undefined;
    }
    if (sql.includes('FROM human_pauses')) return undefined;
    return undefined;
  },
  async all() { return []; },
  async run(sql, params) {
    // O outbound automático (fallback/off_hours/faq) grava `answered_by`
    // como literal na própria SQL, não como placeholder — extrai da query
    // do mesmo jeito que o Postgres real receberia. `handleOwnMessage` grava
    // `answered_by` como placeholder (varia entre 'human_manual'/'whatsapp_auto'),
    // então cai no fallback de pegar direto do parâmetro nesse caso.
    if (sql.includes('INSERT INTO messages_log') && sql.includes("'outbound'")) {
      if (dbWriteDelayMs) await new Promise(r => setTimeout(r, dbWriteDelayMs));
      const answeredByMatch = sql.match(/'([a-z_]+)'\)\s*$/i);
      state.log.push({
        phone: params[0],
        direction: 'outbound',
        body: params[1],
        answered_by: answeredByMatch ? answeredByMatch[1] : params[2],
      });
    }
    if (sql.includes('INSERT INTO human_pauses')) {
      state.pauses.push({ phone: params[0] });
    }
    return { rows: [] };
  },
});
registerFake('../engine/faqSearch', { async search() { return null; } });
registerFake('./jidUtils', { async resolvePhone(jid) { return jid.replace('@s.whatsapp.net', ''); } });

const messageHandlerPath = path.join(__dirname, '../src/bot/messageHandler.js');
const { handleMessage, handleOwnMessage } = require(messageHandlerPath);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function makeMsg(id, jid, text) {
  return { key: { remoteJid: jid, fromMe: false, id }, message: { conversation: text } };
}

async function runMessageHandlerCases() {
  console.log('\nmessageHandler — race condition entre turnos de buffer');

  state.config = {
    debounce_seconds: '0.05',
    working_hours_start: '0',
    working_hours_end: '23',
  };

  await test('duas rajadas espaçadas com escrita lenta no banco não duplicam o fallback', async () => {
    state.log = [];
    dbWriteDelayMs = 80;
    const sent = [];
    const sendMessage = async (jid, text) => { sent.push({ jid, text }); };
    const jid = '5511999999999@s.whatsapp.net';

    await handleMessage(makeMsg('m1', jid, 'oi'), sendMessage, null);
    await new Promise(r => setTimeout(r, 60)); // deixa o turno 1 disparar e começar a escrever (lento)

    await handleMessage(makeMsg('m2', jid, 'oi de novo'), sendMessage, null);
    await new Promise(r => setTimeout(r, 400)); // espera os dois turnos terminarem de vez

    assert.equal(sent.length, 1, `esperava 1 mensagem de fallback, veio ${sent.length}: ${JSON.stringify(sent.map(s => s.text))}`);
  });

  await test('conversas de telefones diferentes continuam respondendo em paralelo (fila não é global)', async () => {
    state.log = [];
    dbWriteDelayMs = 60;
    const sent = [];
    const sendMessage = async (jid, text) => { sent.push({ jid, text }); };

    await Promise.all([
      handleMessage(makeMsg('p1', '5511111111111@s.whatsapp.net', 'oi'), sendMessage, null),
      handleMessage(makeMsg('p2', '5522222222222@s.whatsapp.net', 'oi'), sendMessage, null),
    ]);
    await new Promise(r => setTimeout(r, 250));

    assert.equal(sent.length, 2, `esperava 1 fallback por telefone (2 no total), veio ${sent.length}`);
    dbWriteDelayMs = 0;
  });
}

function makeOwnMsg(id, jid, text) {
  return { key: { remoteJid: jid, fromMe: true, id }, message: { conversation: text } };
}

async function runHandleOwnMessageCases() {
  console.log('\nmessageHandler — handleOwnMessage() distingue saudação automática do WhatsApp de resposta humana real');
  // Portado da Eva grande (eva-test, commit 03e8e5d, 09/09/2026): o WhatsApp
  // Business marca a Saudação/Resposta Rápida automática (fromMe) com um
  // caractere invisível (U+200E) no início do texto, que não aparece em
  // texto digitado de verdade. Sem distinguir isso, cada cliente novo que
  // recebesse essa saudação automática pausava o bot por `human_pause_hours`
  // (6h por padrão aqui) achando que um humano tinha assumido a conversa.

  await test('saudação automática do WhatsApp (marcador U+200E) não pausa o bot', async () => {
    state.log = [];
    state.pauses = [];
    const jid = '5511999999999@s.whatsapp.net';
    const autoText = '‎Olá! Obrigado por entrar em contato.';

    await handleOwnMessage(makeOwnMsg('auto1', jid, autoText), new Set(), null);

    assert.equal(state.log.length, 1, 'deveria logar a saudação automática');
    assert.equal(state.log[0].answered_by, 'whatsapp_auto', 'answered_by deveria ser whatsapp_auto');
    assert.equal(state.pauses.length, 0, 'NÃO deveria pausar o bot pra saudação automática');
  });

  await test('resposta manual real (sem marcador) continua pausando o bot normalmente', async () => {
    state.log = [];
    state.pauses = [];
    const jid = '5511999999999@s.whatsapp.net';

    await handleOwnMessage(makeOwnMsg('manual1', jid, 'Oi, pode deixar que eu te atendo aqui'), new Set(), null);

    assert.equal(state.log.length, 1, 'deveria logar a resposta manual');
    assert.equal(state.log[0].answered_by, 'human_manual', 'answered_by deveria continuar human_manual');
    assert.equal(state.pauses.length, 1, 'DEVERIA pausar o bot pra resposta manual real');
  });

  await test('eco do próprio envio do bot (id conhecido) continua ignorado, sem logar nem pausar', async () => {
    state.log = [];
    state.pauses = [];
    const jid = '5511999999999@s.whatsapp.net';
    const sentIds = new Set(['echo1']);

    await handleOwnMessage(makeOwnMsg('echo1', jid, 'resposta automática do bot'), sentIds, null);

    assert.equal(state.log.length, 0, 'eco do próprio bot não deveria gerar log nenhum');
    assert.equal(state.pauses.length, 0, 'eco do próprio bot não deveria pausar nada');
  });
}

(async () => {
  await runMessageHandlerCases();
  await runHandleOwnMessageCases();

  console.log(`\n${passed} passou, ${failed} falhou.`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
