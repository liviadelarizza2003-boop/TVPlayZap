'use strict';
/**
 * clientExtractor.js — Extração de clientes a partir do histórico de conversas
 *
 * Fluxo:
 *  1. Agrupa messages_log por telefone (ignorando quem já é cliente cadastrado
 *     ou já tem uma sugestão pendente/revisada)
 *  2. Para cada telefone, monta a conversa cronológica e pergunta ao Groq
 *     se dá pra identificar nome, plano e data de vencimento
 *  3. Salva como client_candidates com status 'pending' para a Livia revisar
 *     no módulo "Treinar a Livia"
 *
 * Pode ser chamado via API POST /api/onboarding/analyze-clients
 * Roda em background — o endpoint retorna imediatamente e o progresso
 * é consultado via GET /api/onboarding/clients-status
 */

const db = require('../db/db');

let state = {
  running:   false,
  total:     0,
  processed: 0,
  generated: 0,
  error:     null,
  finishedAt: null,
};

function getState() { return { ...state }; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MAX_MESSAGES_PER_PHONE = 80;   // mensagens mais recentes consideradas por conversa
const DELAY_MS               = 6000; // pausa entre chamadas ao Groq (respeita rate limit do free tier)

/** Telefones com conversa no log que ainda não são cliente nem têm sugestão registrada */
async function collectCandidatePhones() {
  const rows = await db.all(`
    SELECT DISTINCT phone FROM messages_log
    WHERE phone NOT IN (SELECT phone FROM clients)
      AND phone NOT IN (SELECT phone FROM client_candidates)
  `);
  return rows.map(r => r.phone);
}

/** Monta a conversa (mais recente primeiro no banco, cronológica no prompt) de um telefone */
async function buildConversation(phone) {
  const rows = await db.all(
    `SELECT direction, body, sent_at FROM messages_log
     WHERE phone = ?
     ORDER BY sent_at DESC
     LIMIT ?`,
    [phone, MAX_MESSAGES_PER_PHONE]
  );
  return rows.reverse().map(r => {
    const date = new Date(r.sent_at).toISOString().split('T')[0];
    const who  = r.direction === 'inbound' ? 'Cliente' : 'Você';
    return `[${date}] ${who}: ${r.body}`;
  }).join('\n');
}

/** Pergunta ao Groq se dá pra extrair nome/plano/vencimento da conversa */
async function askGroqForClientInfo(phone, conversation) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada no .env');

  const today = new Date().toISOString().split('T')[0];

  const prompt = `Você é um assistente que ajuda a extrair dados cadastrais de clientes a partir de uma conversa de WhatsApp entre um negócio e um cliente.

Hoje é ${today}. Abaixo está o histórico de mensagens trocadas com o telefone ${phone}, cada uma com a data em que foi enviada.

${conversation}

A partir dessa conversa, tente identificar:
- "name": o nome do cliente (como ele se apresentou, ou como o negócio se refere a ele). Use null se não der pra saber.
- "plan": o plano, produto ou serviço contratado, se mencionado. Use null se não souber.
- "due_date": a data de vencimento/renovação do plano do cliente, no formato YYYY-MM-DD. Se alguma mensagem menciona uma data relativa (ex: "vence dia 20", "renova daqui a um mês"), calcule a data absoluta usando a data da mensagem como referência. Use null se não for possível determinar.

Responda APENAS um JSON válido, sem explicação, sem markdown, no formato exato:
{"name": "...", "plan": "...", "due_date": "YYYY-MM-DD"}
Use null (não a string "null") nos campos que não conseguir identificar.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:       'llama-3.3-70b-versatile',
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  300,
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq respondeu ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || '{}';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    console.error('[clientExtractor] JSON inválido do Groq:', text.slice(0, 200));
    return null;
  }
}

/** Roda em background. Chame sem await. */
async function runExtraction() {
  if (state.running) {
    throw new Error('Extração já em andamento');
  }

  state = { running: true, total: 0, processed: 0, generated: 0, error: null, finishedAt: null };

  try {
    const phones = await collectCandidatePhones();
    state.total = phones.length;

    if (phones.length === 0) {
      state.running = false;
      state.finishedAt = new Date().toISOString();
      return;
    }

    for (const phone of phones) {
      try {
        const conversation = await buildConversation(phone);
        const info = await askGroqForClientInfo(phone, conversation);
        const dueDate = info?.due_date && /^\d{4}-\d{2}-\d{2}$/.test(info.due_date) ? info.due_date : null;

        if (info && (info.name || dueDate)) {
          await db.run(
            `INSERT INTO client_candidates (name, phone, plan, due_date, source_messages)
             VALUES (?, ?, ?, ?, ?)`,
            [info.name || null, phone, info.plan || null, dueDate, JSON.stringify(conversation)]
          );
          state.generated++;
        }
      } catch (err) {
        console.error(`[clientExtractor] Erro no telefone ${phone} (seguindo):`, err.message);
      }

      state.processed++;

      if (state.processed < phones.length) {
        await sleep(DELAY_MS);
      }
    }

    state.running    = false;
    state.finishedAt = new Date().toISOString();
    console.log(`[clientExtractor] Concluído: ${state.generated} clientes sugeridos de ${state.total} conversas.`);

  } catch (err) {
    console.error('[clientExtractor] Falhou:', err);
    state.running   = false;
    state.error     = err.message;
    state.finishedAt = new Date().toISOString();
  }
}

module.exports = { runExtraction, getState };
