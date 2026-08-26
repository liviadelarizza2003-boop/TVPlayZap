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

`399dac0c3745fee1fb2cee59f6bc8181d2920740` (branch `dev`, 2026-08-25 —
"Calibra confiança da IA pelo embasamento real, não só finish_reason")

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

### 2026-08-25 — execução de validação (rodada manualmente, substituindo o "Run now" da tarefa agendada que ainda não existia como skill carregável na sessão)

**Motivo:** testar o mecanismo de sincronização recém-criado (`/sync-eva-lite`
+ rotina semanal) de ponta a ponta antes de confiar nele rodando sozinho.

**Encontrado:** 1 commit novo na Eva desde a baseline (`aeb07c2`) — mas é a
própria nota de processo "pergunte antes de portar correção estrutural"
adicionada no `CLAUDE.md` da Eva nesta mesma sessão, não uma correção de
código. **Nada pra portar.** Resultado esperado e correto — confirma que o
mecanismo de diff funciona (achou exatamente o commit certo, nem mais nem
menos) e que ele reconhece corretamente quando não há nada estrutural pra
avaliar.

### 2026-08-25 — validação pedida pela usuária (não é um /sync-eva-lite completo, script pontual da Eva)

**Motivo:** usuária pediu pra checar se `scripts/merge_7_reconnect_dupes.js`
(script avulso, ainda não commitado na Eva, que mescla 7 contatos duplicados
específicos) representa um desafio que a Lite também tem — o objetivo do
script é garantir que uma nova mensagem do mesmo cliente continue na mesma
conversa/histórico em vez de fragmentar.

**Avaliado:** o script em si não se aplica — a Lite não tem tabela de
`contacts` nem `conversations` pra ter "duplicata" nesse sentido. **Mas o
desafio de fundo existia aqui de outra forma**: `reconcileLidPhones()`
nunca funcionou desde que foi criado (12/08/2026), por um descompasso entre
o que `resolvePhone()` grava e o que o corretor procura — telefones
mal-resolvidos (`@lid`) ficavam fragmentados pra sempre, com o mesmo efeito
prático (histórico dividido) que o script da Eva existe pra evitar lá.
**Corrigido** em `src/bot/jidUtils.js` + `src/bot/lidReconcile.js` — detalhe
completo em `CLAUDE.md`, seção "Correção de telefone `@lid` nunca resolvido
de fato". Não é um port literal do script da Eva, é uma correção
independente motivada pela mesma pergunta.

### 2026-08-25 — sessão de best practices na Eva grande (baseline `aeb07c2` → `399dac0`)

**Motivo:** usuária pediu explicitamente pra portar o que desse de uma sessão
inteira de best practices de chatbot rodada na Eva grande (buffer de
mensagens, confiança da IA/topMatches, dedupe por contato, rastro de
decisão, rate limit, suíte de regressão, confiança real da IA — 7 commits,
`3f12e62`..`399dac0`). Dois commits extras no intervalo (`0e9655a` deep link
`?telefone=` no painel, `bc8af72` fix de paginação do painel espelho Quitta)
não são correções estruturais nem se aplicam aqui (painel próprio distinto;
Quitta é integração exclusiva do tenant Imóveis Santa Cruz) — revisados e
descartados sem ação.

**Portado:**
- **Rate limit por contato** — `isRateLimited()`/`pauseForRateLimit()`
  (`src/bot/messageHandler.js`), config `rate_limit_max_messages`/
  `rate_limit_window_minutes`/`rate_limit_pause_minutes`. Adaptado: reaproveita
  `human_pauses` com uma duração própria mais curta (`GREATEST` pra nunca
  encurtar uma pausa humana real já ativa) em vez do `waiting_human` de
  conversa que a Eva usa — e manda o aviso direto pro WhatsApp de
  `owner_phone` (não existe painel de notificação separado aqui). Detalhe em
  `CLAUDE.md`, seção "Rate limit por contato + primeira suíte de testes".
- **Primeira suíte de regressão deste repo** — `test/regression.js`, cobrindo
  `faqSearch.search()` (mesmo algoritmo/mesma classe de bug da Eva). `npm
  test` roda. Verificado quebrando de propósito `SCATTERED_MATCH_DISCOUNT` e
  confirmando que a suíte acusa a falha antes de reverter.

**Avaliado e descartado (não aplicável à Lite hoje):**
- **Dedupe por contato em vez de por conversa** — o bug de origem (Resolver
  numa conversa `waiting_human` sem resposta humana abrindo uma linha nova
  em branco) depende da Lite ter uma tabela `conversations`, que não existe
  aqui. `wasRecentlySent()` já sempre foi escopado por `phone` direto em
  `messages_log` — o mesmo problema estruturalmente não existe.
- **`topMatches()` filtrando match espalhado fraco (`faq_context_min_score`)**
  — mesmo motivo já registrado na sessão anterior: `topMatches()` existe
  aqui mas não é chamado em lugar nenhum do código (confirmado por busca no
  repo) — não alimenta IA nenhuma, então o corte não teria efeito nenhum.
  Continua sem uso real; possível candidato a remoção futura (dead code),
  não uma correção pendente.
- **Rastro de decisão por mensagem** — depende de categoria (A/B/C/D) e de
  regras de comportamento no prompt da IA, nenhum dos dois existe aqui. O
  pouco que faria sentido guardar (FAQ que bateu + score) já está em
  `messages_log.faq_id`/`confidence` desde sempre.
- **Confiança real da IA (`blendConfidence`)** — não há resposta livre por
  IA nesta Lite, só FAQ fixo + fallback fixo; não existe `confidence` de IA
  nenhum pra calibrar.

**Se revisar essa sessão depois:** o commit-base acima já reflete o estado
da Eva analisado nesta sessão — próxima sincronização parte dele.
