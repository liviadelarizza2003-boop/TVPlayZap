'use strict';
/**
 * historyAnalyzer.js — Onboarding Inteligente
 *
 * Fluxo:
 *  1. Lê todas as mensagens inbound do log (gravadas pelo bot desde que rodou)
 *     OU lê diretamente do store do Baileys se chamado no primeiro boot.
 *  2. Normaliza e deduplica mensagens (filtro local, sem custo de IA).
 *  3. Envia lotes para o Groq (llama-3.3-70b) que agrupa por tema e gera
 *     pares pergunta/resposta sugeridos.
 *  4. Salva como faq_candidates com status 'pending' para a Livia revisar
 *     no módulo "Treinar a Livia".
 *
 * Pode ser chamado via API POST /api/onboarding/analyze
 * Roda em background — o endpoint retorna imediatamente e o progresso
 * é consultado via GET /api/onboarding/status
 */

const db      = require('../db/db');

// Estado em memória da análise em andamento
let analysisState = {
  running:   false,
  total:     0,
  processed: 0,
  generated: 0,
  error:     null,
  finishedAt: null,
};

function getState() { return { ...analysisState }; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Filtra e deduplica mensagens inbound do log */
function collectUniqueMessages() {
  const rows = db.all(
    `SELECT body FROM messages_log
     WHERE direction = 'inbound' AND body IS NOT NULL AND body != ''
     ORDER BY sent_at`
  );

  const seen = new Map(); // normalizado → original
  for (const { body } of rows) {
    const norm  = normalize(body);
    const words = norm.split(' ').filter(Boolean);
    if (words.length < 3) continue; // saudações/respostas curtas não viram FAQ
    if (!seen.has(norm)) seen.set(norm, body.trim());
  }

  return [...seen.values()];
}

/**
 * Chama o Groq para agrupar mensagens e gerar pares pergunta/resposta.
 * Retorna array de { question, answer, sourceMessages[] }
 */
async function askGroqForFaqSuggestions(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada no .env');

  const businessName = db.get("SELECT value FROM config WHERE key = 'business_name'")?.value || 'o negócio';

  const listaMsgs = messages.map((m, i) => `[${i}] ${m}`).join('\n');

  const prompt = `Você é um assistente que ajuda a criar FAQs para negócios.

Abaixo estão mensagens reais enviadas por clientes de "${businessName}".
Agrupe as mensagens por tema/intenção similar e para cada grupo crie:
- Uma "question" clara (como o cliente costuma perguntar)
- Uma "answer" útil e simpática (deixe "[COMPLETAR]" onde a Lívia precisa preencher a resposta real)
- "sourceIndexes": array com os índices [N] das mensagens que geraram o grupo

Retorne APENAS um JSON válido com este formato exato:
[
  {
    "question": "Como faço para renovar meu plano?",
    "answer": "Para renovar seu plano, [COMPLETAR]. Qualquer dúvida é só chamar! 😊",
    "sourceIndexes": [0, 3, 7]
  }
]

Mensagens dos clientes:
${listaMsgs}

Regras:
- Agrupe mensagens com a mesma intenção, mesmo que com palavras diferentes
- Ignore saudações isoladas ("oi", "olá") se não tiverem pergunta
- Gere no máximo 20 grupos
- Responda SOMENTE o JSON, sem explicação, sem markdown`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  4000,
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq respondeu ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '[]';

  // Extrai JSON mesmo se a IA envolver em ```json```
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('[historyAnalyzer] JSON inválido do Groq:', text.slice(0, 200));
    return [];
  }
}

const BATCH_SIZE = 40;   // mensagens por chamada ao Groq
const DELAY_MS   = 12000; // pausa entre lotes (respeita rate limit do free tier)

/**
 * Roda em background. Chame sem await.
 * @param {string[]} [extraMessages] — mensagens adicionais (ex: coladas pelo usuário)
 */
async function runAnalysis(extraMessages = []) {
  if (analysisState.running) {
    throw new Error('Análise já em andamento');
  }

  analysisState = { running: true, total: 0, processed: 0, generated: 0, error: null, finishedAt: null };

  try {
    const fromLog    = collectUniqueMessages();
    const allMsgs    = [...new Set([...fromLog, ...extraMessages.filter(m => m?.trim().length > 5)])];

    analysisState.total = allMsgs.length;

    if (allMsgs.length === 0) {
      analysisState.running   = false;
      analysisState.finishedAt = new Date().toISOString();
      return;
    }

    for (let i = 0; i < allMsgs.length; i += BATCH_SIZE) {
      const batch = allMsgs.slice(i, i + BATCH_SIZE);

      try {
        const suggestions = await askGroqForFaqSuggestions(batch);

        for (const s of suggestions) {
          if (!s.question || !s.answer) continue;

          // Mapeia índices relativos ao lote de volta para as mensagens originais
          const sourceMsgs = (s.sourceIndexes || [])
            .filter(idx => idx >= 0 && idx < batch.length)
            .map(idx => batch[idx]);

          db.run(
            `INSERT INTO faq_candidates (question, answer, source_messages)
             VALUES (?, ?, ?)`,
            [s.question.trim(), s.answer.trim(), JSON.stringify(sourceMsgs)]
          );

          analysisState.generated++;
        }
      } catch (batchErr) {
        console.error('[historyAnalyzer] Erro no lote (seguindo):', batchErr.message);
      }

      analysisState.processed += batch.length;

      if (i + BATCH_SIZE < allMsgs.length) {
        await sleep(DELAY_MS);
      }
    }

    analysisState.running    = false;
    analysisState.finishedAt = new Date().toISOString();
    console.log(`[historyAnalyzer] Concluído: ${analysisState.generated} sugestões geradas de ${analysisState.total} mensagens.`);

  } catch (err) {
    console.error('[historyAnalyzer] Falhou:', err);
    analysisState.running = false;
    analysisState.error   = err.message;
    analysisState.finishedAt = new Date().toISOString();
  }
}

module.exports = { runAnalysis, getState };
