# EVA_SYNC_LOG.md — histórico de sincronização Eva ↔ Eva Lite

Registro de correções estruturais da Eva "grande" (`C:\Sistemas\eva-test`,
branch `dev`) avaliadas quanto à aplicabilidade na Eva Lite (este repo), e
vice-versa. Existe pra três coisas não se perderem/repetirem:

1. **Não reavaliar de novo** uma correção da Eva que já foi analisada e
   descartada como "não aplicável" (evita o mesmo raciocínio ser refeito do
   zero em toda sessão nova).
2. **Saber de onde retomar** — `/sync-eva-lite` (manual) e a rotina semanal
   automática usam o campo "Último commit da Eva revisado" abaixo como ponto
   de partida (`git log <sha>..HEAD` em `eva-test`), em vez de reler o
   histórico inteiro toda vez.
3. **Dar contexto pra quem perguntar "por que isso não foi portado?"** — cada
   linha descartada tem o motivo, não só um "não".

Ver a instrução ao vivo (perguntar à usuária no meio de uma sessão normal,
sem esperar o próximo ciclo) em `eva-test/CLAUDE.md` e `CLAUDE.md` (deste
repo), seção "⚠️ Produto-irmão".

---

## Último commit da Eva revisado

`0834b657795e1a908b039388f93a8f3d099ca3ef` (branch `dev`, 2026-08-25 14:46 —
"Corrige conversa vazia flutuando pro topo da lista (NULLS LAST)")

## Histórico de sincronizações

### 2026-08-25 — sessão inicial (ad-hoc, motivada por relato real de bug)

**Motivo:** usuária relatou que a Eva Lite "endoidou", respondendo sem
pausa pro cliente. Revisão do `eva-test/CLAUDE.md` inteiro (não só desde um
commit específico — primeira sincronização, sem baseline anterior) em busca
de correções estruturais equivalentes.

**Portado:**
- Pausa automática quando um humano responde manualmente (`waiting_human`
  na Eva → `human_pauses` na Lite, adaptado pra detecção via `fromMe`/
  `wa_message_id` em vez de status de conversa, já que a Lite não tem tabela
  `conversations`). Ver `CLAUDE.md` deste repo, seção "Bot sem dar respiro".
- Dedupe de mensagem automática repetida (Eva: 12h só pra "parked" fora do
  horário; Lite: 3h, aplicado a `fallback` e `off_hours`, mais genérico
  porque a Lite não tem categoria de conversa pra restringir o escopo).
- Debounce de mensagens seguidas (15s) — **não existe na Eva grande**, foi
  pedido novo da usuária no mesmo momento, não uma correção portada de lá.
  Se a Eva grande também sofrer desse sintoma no futuro, considerar portar
  no sentido inverso.

**Avaliado e descartado (não aplicável à Lite hoje):**
- Escalonamento por menção a nome de agente em saudação pura (causa #2 do
  bug de "excesso de respostas" da Eva) — depende do classificador A/B/C/D
  (`src/engine/classifier.js`), que a Lite não tem.
- Regra de comportamento (`regras_comportamento`) poluindo todo prompt de IA
  (causa #4) — a Lite não tem resposta livre por IA, só FAQ fixo + fallback
  fixo, então não existe prompt nenhum pra poluir.
- `faqSearch.topMatches()` incluindo match fraco como contexto de IA — mesma
  razão acima (só usado como contexto de prompt de IA na Eva; a Lite usa
  `topMatches` só pra outra finalidade, não alimenta IA nenhuma).

**Se revisar essa sessão depois:** o commit-base acima já reflete o estado
da Eva analisado nesta sessão — próxima sincronização parte dele.
