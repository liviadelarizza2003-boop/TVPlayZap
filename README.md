# 🌸 Eva Lite

Bot de WhatsApp + painel PWA para micro empresas. Responde clientes automaticamente
por FAQ, avisa vencimentos de plano e aprende o FAQ inicial lendo o histórico de
conversas com ajuda de IA (Groq).

> Documentação de arquitetura e decisões de projeto: [implementation_plan.md](implementation_plan.md).

---

## Stack

| Componente | Tecnologia |
|---|---|
| Bot WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) |
| Backend | Node.js 18+ + Express |
| Banco de dados | PostgreSQL ([Supabase](https://supabase.com), plano free) via `pg` |
| IA (análise de histórico) | Groq API (`llama-3.3-70b-versatile`) |
| Agendamento | node-cron |
| Painel | PWA — HTML/CSS/JS puro, sem framework/build step |
| Deploy | Render (free tier) |

---

## Rodando localmente

### 1. Pré-requisitos
- Node.js **18 ou superior**
- Um projeto Postgres gratuito no [Supabase](https://supabase.com) (New Project → Project Settings → Database → Connection String → aba "URI", opção "Session pooler")

### 2. Instalar dependências
```bash
npm install
```

### 3. Configurar variáveis de ambiente
```bash
cp .env.example .env
```
Edite o `.env` e ajuste pelo menos:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | connection string do Postgres (Supabase) — use a versão "Session pooler" (compatível com IPv4) |
| `JWT_SECRET` | string longa e aleatória — usada para assinar o token de login |
| `ADMIN_PASSWORD` | senha inicial do painel (pode ser trocada depois, dentro do painel) |
| `RECOVERY_KEY` | chave de recuperação usada em "Esqueci minha senha" na tela de login, caso a senha do painel seja esquecida — guarde em local seguro |
| `GROQ_API_KEY` | chave gratuita em [console.groq.com](https://console.groq.com) — só é necessária para o botão "Analisar histórico de conversas" |
| `BUSINESS_NAME`, `OWNER_PHONE` | valores padrão de config, também editáveis no painel |
| `WORKING_HOURS_START/END`, `TZ` | horário de atendimento e fuso horário |

### 4. Iniciar o servidor
```bash
npm start          # produção
npm run dev         # com --watch (reinicia sozinho ao salvar arquivos)
```

O servidor sobe em `http://localhost:3200` (ou na porta definida em `PORT`). Ele:
1. Serve o painel PWA (`frontend/`) e a API REST (`/api/*`)
2. Inicia a conexão com o WhatsApp (Baileys) — gera QR Code se não houver sessão salva no Postgres
3. Ativa o cron de lembretes de vencimento (todo dia às 9h, fuso `TZ`)

### 5. Primeiro acesso
1. Abra `http://localhost:3200` e entre com a senha de `ADMIN_PASSWORD` (padrão do exemplo: `livia123`)
2. Vá em **WhatsApp** (menu inferior) e escaneie o QR Code com o celular que vai atender (WhatsApp → Dispositivos Vinculados → Vincular dispositivo). Se esse número já tinha conversas antigas, o WhatsApp sincroniza parte desse histórico automaticamente (pode levar alguns minutos). Se só tiver o próprio celular disponível (sem uma segunda tela pra mostrar o QR), use o link "Só tenho esse celular..." abaixo do QR — ele gera um código de 8 caracteres que se digita no WhatsApp em vez de escanear
3. Em **Treinar a Livia**, use "Analisar histórico de conversas" (aba "FAQ sugerido") para gerar sugestões de FAQ e "Extrair clientes do histórico" (aba "Clientes sugeridos") para identificar nome/plano/vencimento de clientes mencionados nas conversas antigas — ambos exigem `GROQ_API_KEY` e mensagens já sincronizadas em `messages_log`. Revise e aprove cada sugestão antes dela virar FAQ/cliente real — nada é criado automaticamente sem revisão
4. Em **Clientes**, cadastre clientes manualmente com data de vencimento (ou aprove as sugestões do passo acima) para ativar os lembretes automáticos
5. Ao cadastrar um cliente novo, marque **"Iniciar trial de 24h"** para disparar automaticamente (a cada 15min de checagem) a mensagem perguntando se ele quer assinar, 24h depois do cadastro. Quando ele assinar, abra o cliente e use **"Renovar agora"** — o vencimento é recalculado como *hoje + ciclo de renovação* (configurável em Configurações → Negócio, padrão 30 dias), sempre a partir da data real da renovação, não da data original agendada (evita que um atraso "arraste" os lembretes futuros)

> **Privacidade**: a análise de histórico e a extração de clientes enviam o conteúdo das conversas (incluindo nomes e telefones) para a API do Groq processar. Isso já era verdade para o FAQ; agora vale também para o histórico completo sincronizado do WhatsApp.

---

## Estrutura do projeto

```
livia-bot/
├── src/
│   ├── api/
│   │   ├── server.js             ← bootstrap: Express + WebSocket + bot + cron
│   │   └── routes/
│   │       ├── auth.js           ← login por senha única (bcrypt + JWT em cookie httpOnly)
│   │       ├── clients.js        ← CRUD clientes + vencimentos
│   │       ├── faq.js            ← CRUD FAQ ativo + aprovação de candidatas
│   │       ├── onboarding.js     ← dispara análise do histórico (background job)
│   │       └── config.js         ← configurações do negócio + stats do dashboard
│   ├── bot/
│   │   ├── index.js              ← conexão Baileys, QR Code via WebSocket, reconexão automática
│   │   ├── messageHandler.js     ← pipeline de mensagem recebida (horário → FAQ → fallback)
│   │   └── historyIngest.js      ← grava no log o histórico sincronizado ao vincular o WhatsApp (uma vez só)
│   ├── engine/
│   │   ├── faqSearch.js          ← busca por similaridade/proximidade de tokens no FAQ
│   │   ├── historyAnalyzer.js    ← lê mensagens do log → agrupa via Groq → grava faq_candidates
│   │   └── clientExtractor.js    ← agrupa mensagens por telefone → Groq extrai nome/plano/vencimento → grava client_candidates
│   ├── db/
│   │   ├── db.js                 ← wrapper async sobre `pg` (Postgres/Supabase)
│   │   └── schema.sql            ← tabelas: clients, faq, faq_candidates, config, renewal_notifications, messages_log
│   └── scheduler/
│       └── renewalReminder.js    ← cron diário (9h) de lembretes de vencimento
├── frontend/                     ← PWA (SPA sem build step)
│   ├── index.html
│   ├── manifest.json
│   ├── sw.js                     ← service worker (cache do shell; API/WS sempre vão pra rede)
│   ├── icons/                    ← icon-192.png, icon-512.png (ícones do PWA)
│   ├── css/style.css
│   └── js/
│       ├── app.js                ← roteador SPA + helper `api` (fetch) + gate de autenticação
│       ├── dashboard.js
│       ├── clients.js
│       ├── training.js           ← "Treinar a Livia" (sugestões da IA + FAQ ativo)
│       ├── qrcode.js             ← tela de conexão WhatsApp (WebSocket + fallback polling)
│       └── config.js             ← configurações, FAQ manual, ferramentas (senha, teste de lembrete)
├── data/                         ← sessão do WhatsApp (Baileys), gitignored — efêmero no Render free
├── .env.example
├── .gitignore
├── render.yaml                   ← deploy Render (free tier, sem disco — dados ficam no Supabase)
├── package.json
└── implementation_plan.md        ← histórico de design e decisões técnicas
```

---

## Deploy no Render

O `render.yaml` já está pronto (`render blueprint` — New → Blueprint no dashboard do Render):
- Build: `npm install` / Start: `npm start`
- Plano free do Render (sem disco — não é suportado no free tier)
- Clientes, FAQ, configurações **e a sessão de login do WhatsApp** ficam no Postgres do Supabase (`DATABASE_URL`), que sobrevive a restarts/redeploys/hibernação — não é mais preciso escanear o QR Code de novo a cada atualização de código
- Ainda assim, considere um pinger (ex: [cron-job.org](https://cron-job.org)) batendo na URL a cada ~10 min pra reduzir a hibernação por inatividade — a sessão não é perdida se hibernar, mas o bot fica temporariamente offline até "acordar"
- `JWT_SECRET` é gerado automaticamente pelo Render
- `DATABASE_URL`, `GROQ_API_KEY`, `BUSINESS_NAME`, `OWNER_PHONE`, `ADMIN_PASSWORD`, `RECOVERY_KEY` precisam ser preenchidos manualmente no painel do Render (marcados como `sync: false`)

Depois do deploy, acesse a URL do serviço e faça login normalmente — clientes, FAQ e a conexão do WhatsApp já estarão lá, mesmo depois de uma atualização de código.

---

## Troubleshooting

- **Editei um arquivo em `frontend/js/` e o navegador continua com o código antigo** — o service worker (`sw.js`) faz cache do shell do PWA. Em desenvolvimento, use aba anônima ou dê "Unregister" no service worker (DevTools → Application → Service Workers) e recarregue.
- **Login não funciona / fica piscando entre painel e tela de login** — verifique se `JWT_SECRET` está definido no `.env` e se os cookies não estão sendo bloqueados (o login usa cookie `httpOnly`, `SameSite=Lax`).
- **"Analisar histórico" não gera nenhuma sugestão** — confira se `GROQ_API_KEY` está preenchida no `.env` e se já existem mensagens recebidas registradas em `messages_log` (o bot precisa ter ficado conectado recebendo mensagens antes).
- **Esqueci a senha do painel** — na tela de login, clique em "Esqueci minha senha" e informe a `RECOVERY_KEY` configurada no `.env` (ou nas variáveis de ambiente do Render) junto com a nova senha.
- **QR Code não aparece, ou o código de pareamento não é aceito** — confira os logs do servidor. Se a sessão anterior ficou corrompida ou incompleta, apague as linhas `whatsapp_creds` (tabela `config`) e todas as da tabela `whatsapp_keys` no Supabase e reinicie — o sistema também faz essa limpeza sozinho quando detecta uma sessão inválida.
- **Erro "DATABASE_URL não configurada" ao iniciar** — falta preencher `DATABASE_URL` no `.env` (local) ou nas variáveis de ambiente do Render (produção) com a connection string do Supabase.
- **Erro de conexão `ENOTFOUND db.xxx.supabase.co`** — a conexão direta do Supabase exige IPv6; use a string do **"Session pooler"** (host `aws-0-<região>.pooler.supabase.com`), que funciona em IPv4.

---

## Licença

Uso interno — sem licença pública definida.
