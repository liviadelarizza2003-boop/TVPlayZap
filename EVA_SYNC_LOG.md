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

`601f79bbb1d59e536996ef06d4f4749761690004` (branch `dev`, 2026-08-28 —
"Adiciona backup automático diário (GitHub Actions) + scripts de
recuperação")

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

### 2026-08-31 — rotina semanal automática (baseline `399dac0` → `601f79b`, 11 commits)

**Motivo:** execução agendada normal do `sync-eva-lite`, sem gatilho de
incidente.

**Portado** (commit local `9f893af`, não enviado pro GitHub/Render):
- **Race condition em `respondToMessage()`** (Eva: `0823a3f`/`f0dcfab`, fix +
  suíte de teste) — duas rajadas do mesmo cliente espaçadas mais que
  `debounce_seconds` podiam disparar `respondToMessage()` em paralelo pro
  mesmo telefone; se a primeira ainda estivesse gravando (rede lenta,
  `sendMessage`/`db.run`), a segunda lia `wasRecentlySent()` antes da
  primeira terminar e duplicava a mensagem de fallback/fora-de-horário. Na
  Eva a fila é por `conversation_id`; aqui, sem essa tabela, é por telefone
  direto (`runSerialized()`, `src/bot/messageHandler.js`). Nova suíte
  permanente `test/messageHandlerTurns.js` (`npm test` agora roda as duas
  suítes) — verificado quebrando a fila de propósito e confirmando que o
  teste acusa a duplicata antes de reverter, mesmo padrão da Eva.
- **`.node-version=22` + `engines.node=22.x`** (Eva: `63eeb46`) — esta Eva
  Lite tinha a mesma faixa aberta (`>=18`) que causou o crash de boot na Eva
  grande no Render (`Connection terminated unexpectedly`, Node escolhido
  sozinho pra 26.8.1). Corrigido preventivamente, sem ter sofrido o crash
  ainda.
- **`.githooks/pre-push`** (Eva: `9896de7`) roda `npm test` antes de
  qualquer push, mesmo racional da Eva (sem CI, push pro `main` já é deploy
  no Render). **Não ativado sozinho** — precisa `git config core.hooksPath
  .githooks` uma vez por pasta de trabalho; esta sincronização automática
  não roda comando de configuração de git por conta própria, documentado em
  `CLAUDE.md`.

**Avaliado e descartado (não aplicável à Lite hoje):**
- **Correção do `information_schema.tables` sem `table_schema='public'`**
  (Eva: `b40c79f`, bug real no Supabase — batia na `realtime.messages` de
  fábrica e achava que o schema já existia) — mecanismo não existe aqui.
  `initSchema()` desta Lite não faz checagem de "schema já existe" nenhuma,
  só roda `schema.sql` inteiro (`CREATE TABLE IF NOT EXISTS`) em todo boot,
  sempre idempotente. O bug estruturalmente não tem onde acontecer.
- **`datetime(text,text)` no compat SQLite→Postgres + transcrição de áudio
  de histórico** (Eva: `0823a3f`, dois bugs em `importHistorySync()`) — esta
  Lite não tem `importHistorySync()` nem reimportação de histórico via
  reconexão (confirmado: nenhuma referência a `importHistorySync`/
  `transcribeAudio` no repo).
- **Tudo relacionado ao painel de conversas em tempo real** (Eva:
  `5b09b86` atualização do menu esquerdo, `af69632` lista atualizando
  sozinha, `9c81ca6` duplicata de encaminhamento por clique repetido) — o
  `frontend/js/dashboard.js` desta Lite é só stats/vencimentos, sem lista de
  conversas, WebSocket em tempo real, nem função de encaminhar mensagem.
  Mecanismo não existe.
- **Integração Quitta** (Eva: `a703dfa` aviso de cobrança, `89bee45` banner
  de cobrança por deep link) — integração exclusiva do tenant Imóveis Santa
  Cruz, não existe nesta Lite.
- **Backup automático diário via GitHub Actions** (Eva: `601f79b`) — inicialmente
  deixado como sugestão pra decisão humana (ver texto original abaixo,
  mantido pra rastro). **Atualização no mesmo dia: a usuária pediu
  explicitamente ("precisamos do backup para tudo, é um risco que não
  podemos correr") — implementado em seguida, commit local separado, ver
  entrada "2026-08-31 (mesmo dia, pedido explícito da usuária)" logo abaixo.**
  Texto original da avaliação: script da Eva é específico do schema dela
  (tabelas `public` + `quitta`) e adaptar exigiria mapear pra tabelas desta
  Lite, criar a secret `DATABASE_URL` no GitHub Actions deste repo, e
  decidir se `messages_log` (dado de cliente) deveria entrar no backup —
  envolvia escolha de escopo/dado sensível, por isso não foi forçado sem
  perguntar antes.

**Se revisar essa sessão depois:** o commit-base acima já reflete o estado
da Eva analisado nesta sessão — próxima sincronização parte dele.

### 2026-08-31 (mesmo dia, pedido explícito da usuária) — backup automático implementado

**Motivo:** resposta direta da usuária ao resumo da sincronização acima —
"Precisamos do backup para tudo, é um risco que não podemos correr." Não é
mais uma sugestão condicional, é pedido explícito.

**Implementado** (não commitado neste log ainda porque ainda não houve
`git commit` desta parte no momento em que este texto foi escrito — ver
commit real no histórico do `git log` deste repo, mensagem "Adiciona backup
automático diário..."):
- `scripts/backup_scheduled.js` — adaptado do script da Eva grande pro
  schema desta Lite: exporta `config`, `clients`, `faq`, `faq_candidates`,
  `client_candidates`, `renewal_notifications`, `human_pauses` e
  **`messages_log`** (diferente da Eva grande, que deixa mensagens de fora —
  ver `CLAUDE.md`, seção "Backup automático diário", pro porquê da
  diferença) pra `backups/latest/*.json`.
- **Exclusões deliberadas de credencial/sessão**, decisão tomada sem
  perguntar (fora do escopo do pedido, mas necessária pra não trocar "risco
  de perder dado" por "risco de vazar credencial"): tabela `whatsapp_keys`
  inteira (sessão Baileys) e as chaves `whatsapp_creds`/`admin_password_hash`
  dentro de `config`. Verificado depois de rodar: nenhuma das três aparece
  no resultado.
- `.github/workflows/backup-db.yml` — roda o script diariamente (03:00 BRT)
  e comita `backups/latest/` se houve mudança. **Precisa da secret
  `DATABASE_URL` no GitHub Actions deste repo — ainda não confirmado se a
  usuária configurou; sem isso o workflow falha todo dia sem avisar
  ninguém.**
- **Testado rodando de verdade contra o Supabase de produção** (não um
  mock — script só faz `SELECT`, sem risco de escrita/Baileys): 8 tabelas
  exportadas com sucesso, confirmado por busca no JSON que as 3 chaves
  sensíveis não vazaram.

**Não implementado, fica pendente:**
- Checagem semanal de saúde do backup (a Eva grande tem uma tarefa
  agendada própria, `check-supabase-backup-health`) — não pedido
  explicitamente ainda, mas o mesmo risco de "workflow quebrado sem
  ninguém perceber" existe aqui também.
- Confirmar que a secret `DATABASE_URL` foi de fato configurada no GitHub
  — ação de conta, só a usuária pode fazer.

### 2026-09-01 (ao vivo, mid-sessão) — corrida entre eco `fromMe` e log da própria resposta do bot

**Motivo:** usuária investigando na Eva grande (tenant Imóveis Santa Cruz)
por que uma saudação automática ("Imobiliária Santa Cruz agradece seu
contato...") aparecia no painel atribuída a "Atendente (fora do painel)"/
humano, quando ela tinha certeza (velocidade da resposta, estilo do texto)
de que não podia ter sido um humano digitando. Achado: `logMessageFull()`
(usado por toda resposta automática da Eva — FAQ/IA) fazia `sock.sendMessage()`
e só DEPOIS logava no banco; se o eco `fromMe` do próprio envio (evento
separado do Baileys) fosse processado antes desse log completar, o branch de
"resposta manual fora do painel" gravava a linha primeiro, e o INSERT da Eva
(sem `ON CONFLICT`) batia no índice único de `wa_message_id` e não conseguia
corrigir depois — sobrava só a atribuição errada. Corrigido lá com
`ON CONFLICT ... DO UPDATE` reclamando a atribuição correta (mesmo padrão já
usado por outra corrida idêntica, documentada em `eva-test/CLAUDE.md`,
"Mensagem do painel duplicando", 29/07/2026).

**Avaliado e PORTADO — a mesma classe de corrida existe aqui, com
consequência pior:** `sendMessage()` (`src/bot/index.js`) chamava
`sock.sendMessage()` e só depois lia `result.key.id` pra registrar em
`botSentMessageIds` — mesma janela de tempo entre "a mensagem já foi
enviada de verdade" e "o bot já sabe que foi ele quem enviou". Se o eco
`fromMe` chegasse (`messages.upsert`) antes de `botSentMessageIds.add(id)`
rodar, `handleOwnMessage()` não reconheceria o id, trataria a resposta
automática do próprio bot como "resposta manual digitada no celular" — e
além de logar errado (`answered_by='human_manual'`), chamaria
`setHumanPause(phone)`, **pausando de verdade as respostas automáticas pra
esse cliente por `human_pause_hours` (default 6h)** sem nenhum humano ter
assumido. Consequência prática pior que na Eva grande (lá é só atribuição
errada no painel; aqui silenciaria o bot pro cliente de verdade).

**Correção, adaptada à arquitetura desta Lite** (não dá pra usar
`ON CONFLICT` — `botSentMessageIds` é um `Set` em memória, não linha de
banco): em vez de descobrir o id da mensagem *depois* do envio, `sendMessage()`
agora gera o id **antes** (`generateMessageIDV2`, já exportado pelo
`@whiskeysockets/baileys` instalado neste repo), registra em
`botSentMessageIds` **antes** de chamar `sock.sendMessage()`, e passa esse id
explicitamente via `{ messageId: id }` (opção documentada do próprio Baileys,
confirmada lendo `node_modules/@whiskeysockets/baileys/lib/Socket/messages-send.js`).
Fecha a janela de corrida por completo (o id já é conhecido antes de qualquer
I/O), em vez de só reduzi-la.

**Testado:** `npm test` (`test/regression.js` + `test/messageHandlerTurns.js`)
passa sem mudança — nenhum dos dois cobre `bot/index.js`/Baileys real
(exigiria mockar o socket), então esta corrida específica não ficou coberta
por teste automatizado; validado só por leitura do código-fonte da lib
instalada, não foi reproduzida ao vivo contra um WhatsApp real.

**Não avaliado ainda:** se essa mesma corrida (eco chegando antes do log)
também afeta os pontos de `messages_log` fora do `respondToMessage()` normal
(ex.: `ai_disclosure`, `off_hours`, `fallback` — todos chamam a mesma
`sendMessage()` corrigida, então já se beneficiam do fix, mas não foram
auditados individualmente por um cenário de corrida próprio).

### 2026-09-10 (ao vivo, mid-sessão) — saudação pura ofuscando FAQ com conteúdo real

**Motivo:** usuária reportou, na Eva grande (tenant Imóveis Santa Cruz), que
alguém perguntou se havia imóveis disponíveis e a Eva não indicou o site,
como a FAQ deveria fazer. Investigação contra o Postgres de produção achou o
caso real: contato mandou "Oi boa tarde,estou precisando alugar. Nada
ainda??" (09/09/2026, 19:34) — a FAQ de saudação pura ("boa tarde" → "Olá!
Tudo bem?") bateu confidence=1 (frase de 2 palavras, adjacente, na ordem —
o algoritmo de `scorePhrase` não distinguia "a frase-gatilho é TODA a
mensagem" de "a frase-gatilho é só o preâmbulo de um pedido real"), venceu a
FAQ de imóvel disponível (que só alcançava um match espalhado, score 0.25,
por falta de uma keyword cadastrada pra essa forma de dizer "preciso
alugar") e o cliente só recebeu o cumprimento + transferência pra humano,
nunca o link do site.

**Avaliado e PORTADO — o algoritmo de `faqSearch.js` é idêntico aqui, mesmo
risco.** Corrigido na Eva grande primeiro (`eva-test/src/engine/faqSearch.js`)
e portado ao vivo pra cá no mesmo pedido da usuária (confirmado
explicitamente, sem esperar o próximo ciclo do `/sync-eva-lite`): frase-
gatilho feita só de palavras de cumprimento (`GREETING_TOKENS`, lista
própria/duplicada aqui, mesmo espírito de `normalize()` já duplicado entre
os dois arquivos) só mantém confidence=1 quando, tirando a frase batida, o
resto da mensagem também é só saudação/filler (`isPureGreetingLeftover`) —
senão cai pra `GREETING_WITH_CONTENT_DISCOUNT` (0.5), mesma magnitude do
`SCATTERED_MATCH_DISCOUNT` já existente. Aplicado nos dois branches de
`scorePhrase` (frase de 1 palavra e de várias).

**Não é suficiente sozinho pra esse caso específico** — mesmo com o
desconto, a FAQ de saudação (0.5) ainda venceria a FAQ de imóvel (0.25) sem
completar também a keyword que faltava ("preciso alugar"/"precisando
alugar"); na Eva grande isso foi corrigido direto na FAQ #1 via UPDATE no
Postgres de produção (dado, não código). Esta Lite não tem o mesmo FAQ de
imóvel disponível (é imobiliária vs. o negócio "TV Play" desta instância) —
nenhuma keyword equivalente foi tocada aqui, só o algoritmo.

**Testado:** `test/regression.js` ganhou 2 casos novos (saudação pura
continua respondendo normal quando é só isso; saudação + pedido real não
ofusca mais a FAQ certa) — `npm test` passa (6 casos no total, era 4).

**Commitado localmente, não enviado pro GitHub/Render** (mesma disciplina já
usada nas sincronizações anteriores) — a usuária decide quando fazer o push.

### 2026-09-18 (ao vivo, mid-sessão) — Eva pausa enquanto o atendente escreve / tela não salta

**Motivo:** usuária reportou na Eva grande dois sintomas com a mesma raiz —
(1) a Eva respondia junto com o atendente que ainda estava digitando, e (2)
o painel pulava pra uma conversa nova no meio de uma digitação ou do chat
interno com um colega. Corrigido em `eva-test` (commit `927a07c`, branch
`dev`, já no GitHub): novo `src/bot/agentPresence.js` (sinal de "atendente
digitando" por contato, em memória), `respondToConversation()` esperando o
atendente parar antes de decidir e de novo antes do envio (`beforeSend` do
`sendHumanized`), e `requestConversationSwitch()`/`isAgentBusy()` no painel.

**Avaliado e NÃO PORTADO — não se aplica a esta Lite.** A pergunta de
aplicabilidade foi feita à usuária ao fim da correção, como pede o
`eva-test/CLAUDE.md`, e ela pediu só o registro aqui (nenhum código da Lite
foi tocado):

- **Pausa enquanto digita:** o sinal vem do campo de mensagem do painel da
  Eva grande (`POST /api/conversations/:id/typing`). A Lite não tem painel de
  conversa nem campo onde um humano digite — não há rota de conversas nem
  `chat-input` em `frontend/` (só clientes, config, treinamento, dashboard).
  O humano responde direto pelo WhatsApp (celular/WhatsApp Web), e a Lite só
  o detecta **depois** do envio, via `fromMe` → `human_pauses`. A digitação
  no aparelho não chega ao bot (o Baileys não entrega a presença do próprio
  número), então não existe sinal pra pausar antes. O `composing` que existe
  em `messageHandler.js` é o da própria Eva.
- **Tela que salta:** é comportamento exclusivo do painel multi-agente da
  Eva grande (`Dashboard.onRealtimeMessage`); a Lite não tem equivalente.

**Se um dia a Lite ganhar um painel onde o humano responda:** reavaliar. O
desenho da Eva grande (sinal por contato, espera antes de decidir + checagem
final antes do envio, cancelamento devolvendo `eva_intro_sent`/equivalente) é
o ponto de partida; detalhes na seção "Eva pausa enquanto o atendente
escreve + tela não salta no meio da atividade (18/09/2026)" do
`eva-test/CLAUDE.md`.

**Não alterou o "Último commit da Eva revisado"** acima — esta foi uma
avaliação pontual ao vivo, não uma rodada do `/sync-eva-lite`.

### 2026-09-24 (ao vivo) — Eva indica o site em pedido de imóveis parafraseado

**Motivo:** conversa real na Eva grande (Imóveis Santa Cruz): "ver umas casa
que estão pra locação / pode me enviar algumas" não casou com nenhuma
frase-gatilho da FAQ do site, a IA foi barrada por baixa confiança e o
cliente recebeu "vou acionar alguém" sem o link. Corrigido em `eva-test`
(commit `e391ffa`, branch `dev`, já no GitHub): keywords estreitas na FAQ do
site + `src/engine/propertyIntent.js` (detector de "quer ver imóveis pra
alugar") como rede de segurança antes da transferência genérica.

**Avaliado e NÃO PORTADO — não se aplica a esta Lite.** A pergunta de
aplicabilidade foi feita à usuária, que pediu a avaliação; nenhum código da
Lite foi tocado:

- **O detector é específico de imobiliária** (casa/imóvel/alugar/locação e
  exclusões de proprietário, fiador, vistoria etc.). A Lite é um produto
  genérico por instância (hoje TV Play), e o princípio "indicar o site" é
  regra do negócio da Imóveis Santa Cruz, não do produto. Portar exigiria um
  detector de intenção por negócio, que não existe nem é pedido aqui.
- **O mecanismo que abriu a lacuna não existe na Lite.** Na Eva grande, o
  pedido caiu porque a IA só responde com contexto de FAQ forte
  (`blendConfidence`, `ai_min_confidence`) e o fallback era uma transferência
  genérica sem link. A Lite não tem IA livre nem esse corte: quando a FAQ não
  casa, `messageHandler.js` manda a `fallback_message` ("vou chamar a
  Lívia"), por desenho, uma vez por janela (`wasRecentlySent`).
- **O que vale como lição, sem mudar código:** o `tokenize()` da Lite é o
  mesmo (`w.length > 2`, descarta "me", "do", "da"), então frase-gatilho de só
  2 palavras úteis é larga — "me enviar casas" vira "enviar casa" e casa com
  "enviar os documentos do fiador da casa" (achado pelo teste da Eva grande).
  Ao cadastrar keywords na Lite, preferir frases de 3+ palavras úteis. Não há
  bug de código a corrigir aqui.

**Se um dia a Lite ganhar um princípio de "sempre indicar X" por negócio:**
o desenho da Eva grande (`propertyIntent.js` + `findPropertySearchFaq()`
localizando a FAQ por dado/config, dedupe por contato) é o ponto de partida.

**Não alterou o "Último commit da Eva revisado"** acima — avaliação pontual ao
vivo, não uma rodada do `/sync-eva-lite`.
