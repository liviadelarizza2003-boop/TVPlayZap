# Eva Lite — contexto do projeto

## ⚠️ Produto-irmão: a Eva "grande" (`C:\Sistemas\eva-test`) — checar antes de fechar uma correção estrutural

**Este projeto é derivado da Eva "grande"**, um bot de suporte/imobiliária
bem mais maduro e com muito mais uso/testes reais (`C:\Sistemas\eva-test`,
branch `dev`, deployada no Render desde antes desta). Vários padrões daqui já
vieram de lá (`faqSearch.js`, mensagem de identidade "você é uma IA?", pausa
pós-atendimento humano + debounce + dedupe adicionados em 25/08/2026 — ver
seção própria abaixo). Decisão combinada com a usuária em 25/08/2026:
**sempre que uma correção aqui for estrutural** (fluxo de mensagem,
race condition, algo que muda como o bot responde/pausa/agrupa mensagens),
**pergunte à usuária se a Eva grande já tem esse problema ou se o mesmo
princípio deveria ser aplicado lá também, antes de considerar o trabalho
encerrado.** Não decida sozinho — ela quer ser consultada nesse momento.

Ver `eva-test/CLAUDE.md` (seção espelho desta) e `EVA_SYNC_LOG.md` (histórico
de correções já avaliadas/portadas de um lado pro outro) antes de perguntar.
Existe também um comando `/sync-eva-lite` (revisão retroativa completa desde
o último ponto sincronizado, sempre no sentido Eva → Eva Lite — a Eva grande
é quem tem os testes de verdade) e uma rotina semanal automática equivalente
— este aviso aqui é o complemento **ao vivo**, pro caso de uma correção
pontual no meio de uma sessão normal de trabalho nesta Eva Lite.

Bot de WhatsApp (Baileys) + painel PWA para micro empresas: FAQ automático,
lembretes de vencimento, trial de 24h. Stack e setup completos em
[README.md](README.md); histórico de decisões de design em
[implementation_plan.md](implementation_plan.md).

## Objetivo do negócio — LEIA ANTES DE DECIDIR ARQUITETURA

**O Eva Lite precisa virar um produto vendável para vários clientes, não
ficar um sistema sob medida só para a Livia (negócio "TV Play").** Isso deve
pesar em qualquer decisão de arquitetura a partir de agora.

**Realidade atual: single-tenant.** Cada deploy é 1 banco Supabase + 1 serviço
Render + 1 conexão WhatsApp + 1 config de negócio. Não há isolamento
multi-cliente no código — tudo assume "uma empresa por instância".

**Caminho recomendado pra vender pra mais gente, sem reescrever o sistema:**
implantar uma instância *separada* (Render + Supabase próprios) por cliente,
a partir deste mesmo repositório/código compartilhado. Não exige mudança de
arquitetura — exige um processo repetível de onboarding (criar projeto
Supabase, subir Blueprint no Render, preencher env vars, cliente conecta o
próprio WhatsApp). Multi-tenant de verdade (1 deploy servindo várias empresas)
é uma opção mais cara/arriscada — só considerar se o volume de clientes
justificar o esforço de reescrita.

**Consequência prática**: qualquer valor específico do negócio da Livia (nome
"TV Play", textos de mensagem, ciclo de renovação etc.) deve continuar sendo
**dado editável na tabela `config`**, nunca hardcoded — o padrão já usado
(`business_name`, `reminder_message`, `ai_disclosure_message`,
`renewal_cycle_days`...) é exatamente o que permite reusar o mesmo código pra
um cliente novo só preenchendo configurações diferentes. Ao adicionar
qualquer mensagem ou comportamento novo, seguir esse padrão.

## Gotchas já resolvidos (não redescobrir)

- **Render free tier não tem disco persistente.** Por isso a sessão do
  WhatsApp (Baileys) é persistida no Postgres (`src/bot/dbAuthState.js`), não
  em arquivo local — senão todo redeploy exigiria reconectar o WhatsApp do
  zero. Isso vale pra qualquer instância nova também.
- **Service Worker do PWA precisa ser "rede primeiro"** (`frontend/sw.js`).
  Cache-first fazia atualizações de código nunca chegarem em quem já tinha o
  app aberto/instalado, mesmo com deploy novo no Render.
- **Telefones do WhatsApp precisam passar por `jidNormalizedUser()`** (Baileys)
  antes de virar "telefone" no banco. JIDs resolvidos de `@lid` ou de
  `remoteJidAlt` às vezes vêm com sufixo de dispositivo (`:0`, `:4`...) — sem
  normalizar, o envio não dá erro nenhum mas a mensagem nunca chega no
  cliente. Ver `src/bot/jidUtils.js`.
- **Contatos endereçados por `@lid`** (identificador interno do WhatsApp) não
  têm o telefone real diretamente — resolver via `key.remoteJidAlt` ou
  `sock.signalRepository.lidMapping.getPNForLID()`.
- **`requestPairingCode` pode ficar preso** em "já vinculado" se um pareamento
  anterior não completar de verdade (Baileys marca `registered=true` sem a
  conexão abrir). `bot/index.js` já reinicia a sessão sozinho nesse caso.
- **Nunca rodar `node src/api/server.js` localmente apontando pra
  `DATABASE_URL` de produção** — isso inicia uma segunda conexão Baileys
  competindo pela mesma sessão da Livia e já causou desconexão real dela.
  Pra testar rotas/lógica sem esse risco, suba um servidor Express temporário
  que monta só os routers necessários e **não chama `bot.connect()`**
  (apagar o arquivo depois — não é pra virar parte do repo).

## Bot "sem dar respiro" pro cliente — corrigido (2026-08-25)

**Sintoma relatado:** o bot respondia toda mensagem do cliente na hora, sem
pausa nenhuma — se o cliente mandasse 2-3 balõezinhos seguidos (comum no
WhatsApp), recebia 2-3 respostas automáticas em sequência; e se a Livia
respondesse manualmente pelo próprio celular, o bot continuava respondendo
sozinho nas mensagens seguintes do mesmo cliente, como se nada tivesse
acontecido. Mesma classe de bug já corrigida antes na Eva "grande"
(`C:\Sistemas\eva-test`, ver seu `CLAUDE.md`/memória `project_eva_excess_auto_replies`)
— aqui a Eva Lite nem tinha os mecanismos de base pra evitar isso.

Três correções em `src/bot/messageHandler.js` + `src/bot/index.js`:

1. **Pausa automática pós-atendimento manual.** `bot/index.js` antes
   ignorava toda mensagem `fromMe` (`if (msg.key.fromMe) continue`) — sem
   nenhuma forma de saber se a própria Livia tinha acabado de responder pelo
   celular (mesmo número do bot). Agora `sendMessage()` registra o
   `wa_message_id` de tudo que o próprio bot manda (`botSentMessageIds`,
   `bot/index.js`); quando chega um evento `fromMe` com um id **desconhecido**,
   é tratado como resposta manual de verdade (`handleOwnMessage`,
   `messageHandler.js`) — loga como `answered_by='human_manual'` e cria/renova
   uma pausa na tabela `human_pauses` (por telefone, `paused_until = agora +
   human_pause_hours`, config editável em Config → Negócio, default 6h).
   Enquanto pausado, `handleMessage` só loga a mensagem do cliente e não
   responde nada.
2. **Debounce de mensagens seguidas.** Antes de rodar o pipeline de resposta,
   `bufferMessage()` espera `debounce_seconds` (config, default 15s,
   Config → Negócio) depois da última mensagem do cliente, juntando várias
   mensagens seguidas numa só resposta (`respondToMessage`, texto combinado
   com `\n`) — evita responder cada balãozinho separado. Mostra "digitando..."
   (`sock.sendPresenceUpdate('composing', jid)`, renovado a cada 5s, mesmo
   padrão do `sendHumanized` da Eva) enquanto espera.
3. **Dedupe de resposta repetida.** `wasRecentlySent()` evita reenviar a
   mesma mensagem automática (`fallback` ou `off_hours`) pro mesmo telefone
   dentro de `auto_reply_dedupe_hours` (config, default 3h) — se o cliente
   mandar várias mensagens sem bater FAQ ao longo de algumas horas, não
   repete "vou chamar a Lívia"/aviso de horário a cada uma.

**Não portado da Eva** (não se aplica a este bot, que não tem classificador
nem resposta livre por IA): escalonamento por menção a nome de agente, e
filtro de regra de comportamento poluindo prompt de IA — nenhum dos dois
existe aqui, só FAQ fixo + fallback fixo.

Testado isolado (mock de `db`/`faqSearch`/`jidUtils`, sem tocar Postgres nem
WhatsApp reais): debounce agrupou 3 mensagens numa resposta só, dedupe
bloqueou repetição, pausa pós-manual bloqueou resposta automática, e o eco
do próprio envio do bot não foi confundido com resposta manual.

## Rate limit por contato + primeira suíte de testes (adicionado 25/08/2026)

Portado de uma sessão de best practices na Eva "grande" (`C:\Sistemas\eva-test`,
ver `EVA_SYNC_LOG.md` — commits desde a baseline `aeb07c2`). Da lista inteira
dessa sessão (buffer de mensagens, dedupe por contato, rate limit, rastro de
decisão, suíte de regressão, confiança real da IA), só duas coisas se
aplicavam de verdade aqui — as outras já existiam nesta forma mais simples
(dedupe já é por telefone, não por "conversa" — este bot não tem tabela de
conversas pra ter esse problema) ou não fazem sentido sem classificador/IA
livre (rastro de decisão, confiança da IA). Ver seção abaixo do por-que de
cada descarte.

- **`isRateLimited(phone)`** (`src/bot/messageHandler.js`) conta mensagens
  inbound desse telefone em `messages_log` dentro de `rate_limit_window_minutes`
  (config, default 5min); acima de `rate_limit_max_messages` (default 15),
  `handleMessage()` chama `pauseForRateLimit(phone)` — cria/renova uma pausa
  em `human_pauses` com duração própria e mais curta (`rate_limit_pause_minutes`,
  default 30min) que a pausa de atendimento humano (`human_pause_hours`,
  default 6h), usando `GREATEST` pra nunca ENCURTAR uma pausa humana de
  verdade já ativa. Cancela qualquer resposta já agendada no buffer
  (`clearBuffer`) e, se `owner_phone` estiver configurado, manda um aviso
  direto pro WhatsApp da dona — não existe painel de notificação separado
  aqui como na Eva grande (`notifyAgents`), só o WhatsApp dela mesma. Só
  dispara uma vez por rajada: a mensagem seguinte já cai no `isHumanPaused`
  antes de chegar no rate limit de novo.
- **Por que o dedupe por contato da Eva grande não se aplicava:** aquele fix
  existia porque a Eva tem uma tabela `conversations` — "Resolver" numa
  conversa `waiting_human` sem resposta humana de verdade abria uma linha
  nova em branco, perdendo o dedupe que só olhava `conversation_id`. Este
  bot não tem `conversations` nem `Resolver` — `wasRecentlySent()` já
  sempre foi escopado por `phone` direto em `messages_log`, então o mesmo
  bug estruturalmente não existe aqui.
- **Por que rastro de decisão e confiança real da IA não se aplicavam:**
  ambos existem pra investigar decisões de classificador A/B/C/D e de
  resposta livre por IA — nenhum dos dois existe aqui (só FAQ fixo +
  fallback fixo). O pouco que faria sentido guardar (qual FAQ bateu, com
  que score) já está em `messages_log.faq_id`/`confidence` desde sempre.
- **`test/regression.js`** — primeira suíte de teste deste repo também
  (mesma ideia da Eva grande: sem dependência nova, mocka `../db/db` via
  `Module._resolveFilename`). Cobre `faqSearch.search()` — o algoritmo foi
  portado quase literal de lá, então sofre a mesma classe de bug (match
  espalhado dando confidence=1 por engano). 4 casos, verificados quebrando
  de propósito o desconto de match espalhado (`SCATTERED_MATCH_DISCOUNT`) e
  confirmando que a suíte acusa a falha antes de reverter. `messageHandler.js`
  (debounce/pausa/dedupe/rate limit) não coberto ainda — exigiria mockar
  Baileys/`sendMessage` também. `npm test` roda a suíte.
- **`rate_limit_max_messages`/`rate_limit_window_minutes`/`rate_limit_pause_minutes`**
  seedados em `schema.sql` (roda em todo boot via `initSchema()`, idempotente
  — diferente da Eva grande, não precisa de script de migração pontual
  separado) e adicionados ao `EDITABLE_KEYS` de `src/api/routes/config.js`
  (editável via API; sem campo dedicado no formulário de Config ainda, mesmo
  estado em que `auto_reply_dedupe_hours` já ficou desde 25/08/2026).

## Correção de telefone `@lid` nunca resolvido de fato — corrigido (2026-08-25)

Motivado pela usuária pedindo pra validar se a Eva Lite tem o mesmo desafio
que um script pontual da Eva grande resolve lá (mesclar contatos duplicados
pra garantir que uma nova mensagem continue na mesma conversa/histórico em
vez de "começar do zero"). A Eva Lite não tem tabela de contatos nem de
conversas, então esse script não se aplica literalmente — mas investigando,
achei a versão equivalente do problema aqui: **`reconcileLidPhones()`
(`src/bot/lidReconcile.js`, existe desde 12/08/2026) nunca corrigiu nada,
desde o dia em que foi criado.**

Causa: a função procura linhas com `phone LIKE '%@lid'`, mas
`resolvePhone()` (`src/bot/jidUtils.js`) já removia esse sufixo antes de
gravar (`jid.replace('@lid', '')`) — os dois arquivos foram commitados juntos
(`96a8b5c`), só que com um descompasso entre o que um grava e o que o outro
procura. Na prática: todo cliente cujo telefone não deu pra resolver no
primeiro contato (WhatsApp endereçando por `@lid` em vez do número real)
ficava com esse identificador bruto gravado como "telefone" **pra sempre**,
mesmo depois do mapeamento do Baileys ficar disponível em conexões
seguintes — o corretor existia, rodava a cada conexão, mas nunca encontrava
essas linhas. Duas consequências reais: (1) `clientExtractor.js` agrupa
`messages_log` por telefone pra sugerir clientes via IA — o histórico dessa
pessoa ficava fragmentado entre o valor de `@lid` e o telefone real (se
resolvido numa mensagem posterior), aparecendo como duas pessoas diferentes
em vez de uma só; (2) a pausa pós-atendimento manual e o dedupe adicionados
nesta mesma sessão (seção acima) são chaveados por telefone — se a mesma
pessoa oscilar entre os dois valores, a pausa/dedupe simplesmente não valem
pra metade das mensagens dela.

**Correção:** `resolvePhone()` agora mantém o sufixo `@lid` no fallback (não
remove mais) — é o marcador que `reconcileLidPhones()` sempre esperou
encontrar. `reconcileLidPhones()` estendido pra também corrigir
`human_pauses` (tabela nova desta sessão, mesma exposição), com tratamento
pro caso de já existir uma pausa pro telefone real (chave primária) — nesse
caso descarta a pausa órfã do `@lid` em vez de tentar duplicar a chave.
`messages_log`/`client_candidates` continuam cobertos como antes.

Testado isolado (mock de `db`, sem tocar Postgres real): telefone não
resolvido mantém o sufixo; telefone resolvido depois vira o número real;
`messages_log`/`client_candidates`/`human_pauses` são corrigidos juntos; e o
caso de colisão de chave primária em `human_pauses` é tratado sem erro.

**Não verificado ainda**: quantos telefones de produção já estão gravados
como `@lid` puro (sem o sufixo, pelo bug antigo) — esses **não** serão
pegos pelo corretor novo, porque já perderam o marcador antes desta correção
existir. Se quiser, dá pra rodar uma consulta pontual em produção pra achar
esses casos e corrigir manualmente (mesmo padrão de script avulso que a Eva
grande usa) — combinar antes de rodar qualquer coisa contra o banco real.

## Recuperação de senha por pergunta secreta (adicionado 2026-09-18)

Segunda forma de recuperar a senha do painel, além da `RECOVERY_KEY` (que fica só nas env vars do Render, longe da mão). Rotas em `src/api/routes/auth.js`:

- `GET /api/auth/recovery-question` — **pública** (a tela de login precisa exibir a pergunta; por isso a pergunta não deve conter a resposta). Devolve `{enabled, question}`.
- `POST /api/auth/security-question` — exige login **e a senha atual** (403 se errada, não 401 — o front trata 401 como sessão expirada). Sem exigir a senha atual, uma sessão esquecida aberta (cookie de 30 dias) bastaria pra plantar uma resposta conhecida e tomar a conta depois.
- `POST /api/auth/reset-password-by-question` — pública; **trava 15 min após 5 respostas erradas seguidas** (contador global em memória, painel é de usuário único). A `RECOVERY_KEY` não passa por essa trava e segue como saída de emergência.

Armazenamento: `config.security_question` (texto) e `config.security_answer_hash` (bcrypt da resposta **normalizada**: sem acento, minúsculas, espaços colapsados). `security_answer_hash` entra em `CONFIG_KEYS_SENSIVEIS` do backup (resposta de pergunta tem pouca entropia, o hash é mais fácil de quebrar offline que o da senha) e não é devolvido por `GET /api/config` (whitelist `EDITABLE_KEYS`). Cadastro na UI: Config → Ferramentas → "Pergunta secreta". Testes: `test/authSecurityQuestion.js` (roda no `npm test`).

## Status conhecido (2026-08-25)

Em investigação: lembretes (manuais e automáticos) aparecem como "enviados"
no banco, sem erro, mas a Livia relata que o cliente não recebe. Já
descartado: telefone com sufixo de dispositivo (corrigido). Hipóteses ainda
não confirmadas: conexão WebSocket "zumbi" (aberta na memória mas morta de
verdade) ou limite anti-spam do WhatsApp por repetição de teste pro mesmo
número em pouco tempo. Próximo passo era checar do lado do celular que
recebe se aparece algum check (cinza/azul) nas mensagens de teste.

## Race condition em `respondToMessage()` — corrigido (2026-08-31, sincronização automática da Eva grande)

Portado de um bug real que a Eva "grande" (`C:\Sistemas\eva-test`) confirmou
contra produção em 26/08/2026 (commit `0823a3f`, ver `EVA_SYNC_LOG.md`): duas
rajadas do mesmo cliente espaçadas mais que `debounce_seconds` viram dois
turnos independentes em `bufferMessage()` (cada rajada dispara seu próprio
timer). Se o primeiro turno ainda estivesse no meio de um `sendMessage()`/
`db.run()` lento (rede ruim, socket do WhatsApp reconectando — não é raro
com Baileys) quando o segundo turno terminasse seu próprio debounce, os dois
`respondToMessage()` rodavam ao mesmo tempo pro mesmo telefone: o segundo
lia `wasRecentlySent()` **antes** do primeiro terminar de gravar sua
resposta no banco, então o dedupe não via nada pra suprimir e os dois
mandavam a mesma mensagem de fallback/fora-de-horário pro cliente.

Na Eva grande a correção serializa por `conversation_id` (ela tem tabela
`conversations`); aqui não existe essa tabela, então a fila é por telefone
direto — `runSerialized()` (`src/bot/messageHandler.js`) encadeia chamadas
de `respondToMessage()` pro mesmo telefone numa fila de promises (telefones
diferentes continuam respondendo em paralelo, sem uma esperar a outra).

**Verificado** com um teste reproduzindo o cenário (write lento no mock de
`db.run` pra forçar a janela de corrida): sem a fila, a suíte pegava 2
mensagens de fallback enviadas pro mesmo cliente; com a fila, só 1 — a
segunda checagem de dedupe já vê a gravação da primeira. Confirmado
quebrando `runSerialized()` de propósito (`return fn()` sem fila) e revertido
depois, mesmo padrão da Eva grande.

**Nova suíte permanente:** `test/messageHandlerTurns.js` (`npm test` agora
roda `test/regression.js && test/messageHandlerTurns.js`) — primeira
cobertura de `messageHandler.js` neste repo (antes só `faqSearch.js` tinha
teste). Cobre o cenário de corrida acima e confirma que telefones diferentes
não ficam bloqueados um pelo outro (a fila é por telefone, não global).

## Node travado em 22.x + hook de pre-push (2026-08-31, sincronização automática da Eva grande)

Duas correções de infraestrutura portadas da Eva grande, que roda no mesmo
tipo de deploy (Render, push já é deploy):

- **`.node-version` (`22`) + `package.json` `engines.node` (`22.x`, era
  `>=18`).** A Eva grande teve um crash real no boot em produção
  (`Connection terminated unexpectedly` ao conectar no Postgres) porque o
  Render escolheu sozinho a versão mais nova disponível (26.8.1) numa faixa
  aberta (`>=18`) — `.node-version` tem prioridade mais alta e evita essa
  escolha automática. Esta Eva Lite tinha a mesma faixa aberta (`>=18`) e o
  mesmo risco, mesmo sem ter sofrido o crash ainda — corrigido
  preventivamente.
- **`.githooks/pre-push`** roda `npm test` antes de qualquer push e cancela
  se algum caso falhar — projeto não tem CI, e o push pro `main` já é o
  deploy no Render, então esse hook é o único gate automático hoje.
  **Precisa ativar uma vez por pasta de trabalho** (`git config
  core.hooksPath .githooks` — config local do git, não vem de um
  `git clone`/`git pull` sozinho); sem isso o hook fica sem efeito, sem
  nenhum aviso visível. Escape hatch pra emergência: `git push --no-verify`.
  **Esta sincronização automática não roda `git config` sozinha** (fora do
  escopo de mudanças automáticas de configuração) — quem for trabalhar
  nesta pasta precisa rodar o comando acima manualmente.

## Backup automático diário (adicionado 31/08/2026, pedido explícito da usuária: "precisamos do backup para tudo, é um risco que não podemos correr")

Portado da Eva grande (`scripts/backup_scheduled.js` + `.github/workflows/backup-db.yml` lá, ver `EVA_SYNC_LOG.md`), adaptado pro schema desta Eva Lite — **`scripts/backup_scheduled.js`** exporta as tabelas de negócio pra `backups/latest/*.json`, comitado no próprio repositório privado a cada execução via **`.github/workflows/backup-db.yml`** (roda 03:00 BRT todo dia, ou sob demanda via "Run workflow" na aba Actions do GitHub).

**Diferença importante em relação à Eva grande: `messages_log` ENTRA no backup aqui, e lá não entra.** A Eva grande deixa mensagens de fora de propósito porque `importHistorySync()` resincroniza o histórico do WhatsApp sozinho numa reconexão nova — esta Eva Lite não tem esse mecanismo, então perder `messages_log` seria perda definitiva. Consequência aceita: o backup passa a conter conteúdo real de mensagem de cliente (texto + telefone) dentro do histórico do Git, mesmo repositório sendo privado — decisão consciente, não um descuido.

**O que fica de fora, de propósito, por ser credencial/sessão e não dado de negócio:**
- Tabela `whatsapp_keys` inteira — chaves do protocolo Signal do Baileys (sessão de login ativa do WhatsApp). Reconectar via QR novo é o caminho de recuperação, não um backup versionado.
- Chave `whatsapp_creds` dentro de `config` — credenciais da sessão (mesmo motivo acima).
- Chave `admin_password_hash` dentro de `config` — hash bcrypt da senha do painel; não tem motivo pra duplicar num backup versionado, trocar a senha continua funcionando normal sem depender disso estar lá.

**Pendência que só a usuária pode resolver:** o workflow precisa da secret `DATABASE_URL` configurada em Settings → Secrets and variables → Actions **do repositório no GitHub** — sem isso, o workflow falha silenciosamente todo dia às 3h sem avisar ninguém. Confirmar que foi configurada antes de contar com o backup rodando de verdade (o script já foi testado rodando manualmente contra o Supabase real e funcionou — só falta essa configuração no lado do GitHub, que é ação de conta/infra, fora do alcance da IA).

Testado ao vivo (31/08/2026) rodando `node scripts/backup_scheduled.js` contra o Supabase de produção: 8 tabelas exportadas (config, clients, faq, faq_candidates, client_candidates, renewal_notifications, human_pauses, messages_log), confirmado por busca direta no JSON que nenhuma das 3 chaves sensíveis acima aparece no resultado.

**Sem checagem semanal de saúde ainda** (a Eva grande tem uma tarefa agendada própria pra isso, `check-supabase-backup-health`) — considerar pedir o mesmo aqui se o backup for realmente crítico pro negócio, senão um workflow quebrado (ex.: secret nunca configurada) só seria percebido no dia em que o backup fizer falta de verdade.
