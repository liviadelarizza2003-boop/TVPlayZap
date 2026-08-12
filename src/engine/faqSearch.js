'use strict';
/**
 * faqSearch.js — Busca por similaridade no FAQ (portado do Eva)
 *
 * Algoritmo:
 *  1. Normaliza texto (minúsculas, sem acento, sem pontuação)
 *  2. Tokeniza + stemLite (tolera plural/conjugação simples em PT-BR)
 *  3. Score por "frases-gatilho" (pergunta + keywords), com detecção de
 *     proximidade de tokens na mensagem — evita falso positivo em mensagens
 *     longas com palavras coincidentes espalhadas.
 */

const db = require('../db/db');

function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tolera conjugação/plural simples: "aceitam" → "aceita", "querem" → "quere"
function stemLite(word) {
  if (word.length >= 5 && /[aeiou][ms]$/.test(word)) return word.slice(0, -1);
  return word;
}

function tokenize(text) {
  return normalize(text).split(' ').filter(w => w.length > 2).map(stemLite);
}

// Cada entrada FAQ vira múltiplas "frases-gatilho": pergunta + cada keyword
function candidatePhrases(faqItem) {
  const phrases = [faqItem.question, ...(faqItem.keywords || '').split(',')];
  return phrases.map(p => p.trim()).filter(Boolean);
}

const PHRASE_PROXIMITY_SLACK   = 3;   // tokens extras tolerados entre os tokens da frase
const SCATTERED_MATCH_DISCOUNT = 0.5; // penalidade se tokens existem mas espalhados/fora de ordem

function scorePhrase(msgTokens, phrase) {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.length === 0) return { score: 0, matches: 0 };

  // Keyword de uma só palavra: bate se estiver na mensagem, independente de posição
  if (phraseTokens.length === 1) {
    const hit = msgTokens.includes(phraseTokens[0]);
    return { score: hit ? 1 : 0, matches: hit ? 1 : 0 };
  }

  // Frase com múltiplas palavras: exige proximidade e ordem
  let searchFrom = 0, firstIdx = -1, lastIdx = -1, matchedInOrder = 0;
  for (const t of phraseTokens) {
    const idx = msgTokens.indexOf(t, searchFrom);
    if (idx === -1) break;
    if (firstIdx === -1) firstIdx = idx;
    lastIdx = idx;
    matchedInOrder++;
    searchFrom = idx + 1;
  }

  if (
    matchedInOrder === phraseTokens.length &&
    (lastIdx - firstIdx + 1) <= phraseTokens.length + PHRASE_PROXIMITY_SLACK
  ) {
    return { score: 1, matches: phraseTokens.length };
  }

  const matches = phraseTokens.filter(t => msgTokens.includes(t)).length;
  return { score: (matches / phraseTokens.length) * SCATTERED_MATCH_DISCOUNT, matches };
}

function better(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  return a.matches > b.matches;
}

function scoreFaqItem(message, faqItem) {
  const msgTokens = tokenize(message);
  let best = { score: 0, matches: 0 };
  for (const phrase of candidatePhrases(faqItem)) {
    const s = scorePhrase(msgTokens, phrase);
    if (better(s, best)) best = s;
  }
  return best;
}

/**
 * Busca no FAQ. Retorna { answer, confidence, faqId } ou null.
 * @param {string} message
 * @param {number} [minConfidence=0.75]
 */
function search(message, minConfidence = 0.75) {
  const items = db.all('SELECT * FROM faq WHERE is_active = 1');
  if (items.length === 0) return null;

  let best = null;
  let bestResult = { score: 0, matches: 0 };

  for (const item of items) {
    const r = scoreFaqItem(message, item);
    if (better(r, bestResult)) {
      bestResult = r;
      best = item;
    }
  }

  if (bestResult.score >= minConfidence) {
    db.run('UPDATE faq SET usage_count = usage_count + 1 WHERE id = ?', [best.id]);
    return { answer: best.answer, confidence: bestResult.score, faqId: best.id };
  }

  return null;
}

/**
 * Retorna os N itens do FAQ mais relacionados à mensagem (para contexto de IA).
 * @param {string} message
 * @param {number} [limit=5]
 */
function topMatches(message, limit = 5) {
  const items = db.all('SELECT * FROM faq WHERE is_active = 1');
  return items
    .map(item => ({ item, result: scoreFaqItem(message, item) }))
    .filter(({ result }) => result.score > 0)
    .sort((a, b) => (b.result.score - a.result.score) || (b.result.matches - a.result.matches))
    .slice(0, limit)
    .map(({ item }) => item);
}

module.exports = { search, topMatches };
