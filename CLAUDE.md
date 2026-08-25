# Eva Lite — contexto do projeto

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

## Status conhecido (2026-08-25)

Em investigação: lembretes (manuais e automáticos) aparecem como "enviados"
no banco, sem erro, mas a Livia relata que o cliente não recebe. Já
descartado: telefone com sufixo de dispositivo (corrigido). Hipóteses ainda
não confirmadas: conexão WebSocket "zumbi" (aberta na memória mas morta de
verdade) ou limite anti-spam do WhatsApp por repetição de teste pro mesmo
número em pouco tempo. Próximo passo era checar do lado do celular que
recebe se aparece algum check (cinza/azul) nas mensagens de teste.
