'use strict';
/**
 * Suíte de regressão — roda com `node test/regression.js` (ou `npm test`),
 * sem dependência nova nenhuma (só `assert`, do próprio Node). Portada da
 * mesma ideia usada na Eva "grande" (`C:\Sistemas\eva-test\test\regression.js`)
 * — este projeto também não tinha test runner nenhum até agora.
 *
 * Cobre só `faqSearch.{search,topMatches}` — o algoritmo foi portado quase
 * literal da Eva grande (mesmo `stemLite`, mesma proximidade de frase, mesmo
 * desconto de match espalhado), então sofre exatamente a mesma classe de bug
 * já documentada lá. `messageHandler.js` (debounce, pausa humana, dedupe,
 * rate limit) não está coberto ainda — exigiria mockar Baileys/`sendMessage`
 * também; próximo passo natural se esta suíte crescer.
 *
 * Como adicionar um caso: copiar um bloco `await test('...', async () => {...})`
 * dentro de `runFaqSearchCases()` e ajustar a mensagem/resultado esperado.
 */

const assert = require('assert/strict');
const Module = require('module');
const path = require('path');

// Mesma infra de mock da Eva grande: qualquer require(request) — de
// qualquer arquivo — cujo texto bata com uma chave registrada aqui resolve
// pro objeto fake em vez do módulo real (sem framework nenhum, sem tocar o
// Postgres/Supabase de verdade).
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

const state = {
  faqItems: [], // linhas de faq
};

registerFake('../db/db', {
  async all(sql) {
    if (sql.includes('FROM faq')) return state.faqItems;
    return [];
  },
  async get() { return null; },
  async run() { return { rows: [] }; },
});

const faqSearchPath = path.join(__dirname, '../src/engine/faqSearch.js');
const { search: faqSearch, topMatches: faqTopMatches } = require(faqSearchPath);

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

async function runFaqSearchCases() {
  console.log('\nfaqSearch.search() / topMatches()');

  // Mesmo bug real documentado na Eva grande (corrigido lá 29/07/2026):
  // frase-gatilho de 2+ palavras dava confidence=1 mesmo com as palavras
  // espalhadas sem relação nenhuma na mensagem — o algoritmo aqui é o mesmo.
  state.faqItems = [
    { id: 1, question: 'tem plano mensal disponivel', keywords: '', answer: 'Sim, temos plano mensal!', is_active: 1 },
    { id: 2, question: 'aceita pix', keywords: 'pix', answer: 'Aceitamos pix!', is_active: 1 },
  ];

  await test('match espalhado fraco não dispara resposta automática', async () => {
    // As 4 palavras da frase-gatilho ("tem plano mensal disponivel") aparecem
    // todas na mensagem, mas espalhadas e fora de ordem, sem relação nenhuma
    // de verdade com "ter um plano disponível" — um bag-of-words puro (sem o
    // desconto de match espalhado) daria confidence=1 aqui por engano.
    const result = await faqSearch('Hoje o estoque esta disponivel, o plano de internet mensal eu ja paguei, mas tem outro assunto');
    assert.equal(result, null, `esperava null, veio: ${JSON.stringify(result)}`);
  });

  await test('frase completa continua respondendo automaticamente', async () => {
    const result = await faqSearch('vocês tem plano mensal disponivel?');
    assert.ok(result && result.faqId === 1, `esperava FAQ 1, veio: ${JSON.stringify(result)}`);
  });

  await test('keyword isolada com conjugação diferente ainda bate (stemLite)', async () => {
    const result = await faqSearch('vocês aceitam pix?');
    assert.ok(result && result.faqId === 2, `esperava FAQ 2, veio: ${JSON.stringify(result)}`);
  });

  await test('mensagem sem relação nenhuma não bate em nada', async () => {
    const result = await faqSearch('bom dia, tudo bem?');
    assert.equal(result, null, `esperava null, veio: ${JSON.stringify(result)}`);
  });

  // Mesmo bug real confirmado em produção na Eva grande 09/09/2026 (ver
  // eva-test/test/regression.js e o comentário de GREETING_TOKENS/
  // isPureGreetingLeftover em src/engine/faqSearch.js): FAQ de saudação pura
  // vencia com confidence=1 mesmo quando a mensagem tinha um pedido real
  // junto — algoritmo idêntico aqui, mesmo risco.
  state.faqItems = [
    { id: 63, question: 'bom dia', keywords: 'bom dia, boa tarde, boa noite, oi, ola', answer: 'Olá! Tudo bem?', is_active: 1 },
    { id: 1, question: 'tem plano mensal disponivel', keywords: 'tem plano mensal disponivel, precisando do plano, preciso do plano', answer: 'Sim, temos plano mensal!', is_active: 1 },
  ];

  await test('saudação pura ainda responde normalmente quando é só isso (não regride)', async () => {
    const result = await faqSearch('Boa tarde, tudo bem?');
    assert.ok(result && result.faqId === 63, `esperava FAQ 63 (saudação pura), veio: ${JSON.stringify(result)}`);
  });

  await test('saudação junto de pedido real não ofusca a FAQ com conteúdo de verdade', async () => {
    const result = await faqSearch('Oi boa tarde, estou precisando do plano. Nada ainda??');
    assert.ok(result && result.faqId === 1, `esperava FAQ 1 (pedido real), veio: ${JSON.stringify(result)}`);
  });
}

(async () => {
  await runFaqSearchCases();

  console.log(`\n${passed} passou, ${failed} falhou.`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
