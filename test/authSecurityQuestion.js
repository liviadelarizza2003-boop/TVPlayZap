'use strict';
/**
 * Testa a recuperação de senha por pergunta secreta (`src/api/routes/auth.js`)
 * — roda com `node test/authSecurityQuestion.js` (ou `npm test`). Mesma infra
 * de mock de `regression.js` (sem dependência nova, sem tocar Postgres real):
 * o `db` vira um Map em memória e o router sobe num Express temporário numa
 * porta efêmera, chamado por `fetch` de verdade.
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

// `config` em memória: só as duas formas de SQL que o router usa
const config = new Map();
registerFake('../../db/db', {
  async get(sql) {
    const key = /key = '([^']+)'/.exec(sql)?.[1];
    return config.has(key) ? { value: config.get(key) } : undefined;
  },
  async run(_sql, params) {
    config.set(params[0], params[1]);
    return { rows: [] };
  },
  async all() { return []; },
});

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const authRouter = require(path.join(__dirname, '../src/api/routes/auth.js'));

const CURRENT_PASSWORD = 'senha-atual-1';
const AUTH = { Authorization: `Bearer ${jwt.sign({ role: 'admin' }, 'livia-secret')}` };

let base;
let server;

async function call(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function resetState() {
  config.clear();
  config.set('admin_password_hash', bcrypt.hashSync(CURRENT_PASSWORD, 4));
  authRouter._questionAttempts.failures = 0;
  authRouter._questionAttempts.lockedUntil = 0;
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  resetState();
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

const setQuestion = (over = {}) => call('POST', '/api/auth/security-question', {
  question: 'Qual o nome do meu primeiro pet?',
  answer: 'Thor',
  currentPassword: CURRENT_PASSWORD,
  ...over,
}, AUTH);

async function run() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/auth', authRouter);
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  console.log('\nRecuperação de senha por pergunta secreta');

  await test('desativada por padrão', async () => {
    const r = await call('GET', '/api/auth/recovery-question');
    assert.deepEqual(r.body, { enabled: false });
  });

  await test('configurar exige login', async () => {
    const r = await call('POST', '/api/auth/security-question', {
      question: 'Qual o nome do meu primeiro pet?', answer: 'Thor', currentPassword: CURRENT_PASSWORD,
    });
    assert.equal(r.status, 401);
    assert.equal(config.has('security_answer_hash'), false);
  });

  await test('configurar exige a senha atual correta (403, não 401)', async () => {
    const r = await setQuestion({ currentPassword: 'errada' });
    assert.equal(r.status, 403);
    assert.equal(config.has('security_answer_hash'), false);
  });

  await test('rejeita pergunta e resposta curtas demais', async () => {
    assert.equal((await setQuestion({ question: 'oi?' })).status, 400);
    assert.equal((await setQuestion({ answer: 'ab' })).status, 400);
    assert.equal(config.has('security_answer_hash'), false);
  });

  await test('configurada: pergunta aparece na consulta pública e a resposta só existe como hash', async () => {
    assert.equal((await setQuestion()).status, 200);
    const r = await call('GET', '/api/auth/recovery-question');
    assert.deepEqual(r.body, { enabled: true, question: 'Qual o nome do meu primeiro pet?' });
    const stored = config.get('security_answer_hash');
    assert.notEqual(stored, 'thor');
    assert.ok(bcrypt.compareSync('thor', stored));
    assert.equal(JSON.stringify(r.body).includes('thor'), false);
  });

  await test('resposta certa (com outra caixa, acento e espaços) troca a senha', async () => {
    await setQuestion({ answer: 'São Paulo' });
    const r = await call('POST', '/api/auth/reset-password-by-question', {
      answer: '  SAO   paulo ', newPassword: 'nova-senha-2',
    });
    assert.equal(r.status, 200);
    assert.ok(bcrypt.compareSync('nova-senha-2', config.get('admin_password_hash')));
  });

  await test('resposta errada não troca a senha', async () => {
    await setQuestion();
    const before = config.get('admin_password_hash');
    const r = await call('POST', '/api/auth/reset-password-by-question', {
      answer: 'rex', newPassword: 'nova-senha-2',
    });
    assert.equal(r.status, 401);
    assert.equal(config.get('admin_password_hash'), before);
  });

  await test('nova senha curta demais é recusada mesmo com a resposta certa', async () => {
    await setQuestion();
    const before = config.get('admin_password_hash');
    const r = await call('POST', '/api/auth/reset-password-by-question', {
      answer: 'thor', newPassword: '123',
    });
    assert.equal(r.status, 400);
    assert.equal(config.get('admin_password_hash'), before);
  });

  await test('sem pergunta configurada, o reset por pergunta é recusado', async () => {
    const r = await call('POST', '/api/auth/reset-password-by-question', {
      answer: 'qualquer', newPassword: 'nova-senha-2',
    });
    assert.equal(r.status, 503);
  });

  await test('5 respostas erradas travam a tentativa — nem a resposta certa passa durante o bloqueio', async () => {
    await setQuestion();
    const before = config.get('admin_password_hash');
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/api/auth/reset-password-by-question', {
        answer: `chute${i}`, newPassword: 'nova-senha-2',
      });
      assert.equal(r.status, 401);
    }
    const locked = await call('POST', '/api/auth/reset-password-by-question', {
      answer: 'thor', newPassword: 'nova-senha-2',
    });
    assert.equal(locked.status, 429);
    assert.equal(config.get('admin_password_hash'), before);

    // passado o bloqueio, a resposta certa volta a funcionar
    authRouter._questionAttempts.lockedUntil = 0;
    const ok = await call('POST', '/api/auth/reset-password-by-question', {
      answer: 'thor', newPassword: 'nova-senha-2',
    });
    assert.equal(ok.status, 200);
  });

  await test('erros isolados não acumulam pra sempre: acerto zera o contador', async () => {
    await setQuestion();
    for (let i = 0; i < 4; i++) {
      await call('POST', '/api/auth/reset-password-by-question', { answer: `x${i}`, newPassword: 'nova-senha-2' });
    }
    const ok = await call('POST', '/api/auth/reset-password-by-question', { answer: 'thor', newPassword: 'nova-senha-2' });
    assert.equal(ok.status, 200);
    assert.equal(authRouter._questionAttempts.failures, 0);
  });

  await test('normalizeAnswer: acentos, caixa e espaços', () => {
    assert.equal(authRouter.normalizeAnswer('  Ação   DE Graças '), 'acao de gracas');
  });

  server.close();
  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed ? 1 : 0);
}

run();
