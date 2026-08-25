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

## Status conhecido (2026-08-25)

Em investigação: lembretes (manuais e automáticos) aparecem como "enviados"
no banco, sem erro, mas a Livia relata que o cliente não recebe. Já
descartado: telefone com sufixo de dispositivo (corrigido). Hipóteses ainda
não confirmadas: conexão WebSocket "zumbi" (aberta na memória mas morta de
verdade) ou limite anti-spam do WhatsApp por repetição de teste pro mesmo
número em pouco tempo. Próximo passo era checar do lado do celular que
recebe se aparece algum check (cinza/azul) nas mensagens de teste.
