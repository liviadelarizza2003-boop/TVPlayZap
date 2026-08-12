# 🌸 Livia Bot (Eva Lite)

Bot de WhatsApp + painel PWA para micro empresas. Responde clientes automaticamente
por FAQ, avisa vencimentos de plano e aprende o FAQ inicial lendo o histórico de
conversas com ajuda de IA (Groq).

> Documentação de arquitetura e decisões de projeto: [implementation_plan.md](implementation_plan.md).

---

## Stack

| Componente | Tecnologia |
|---|---|
| Bot WhatsApp | [Baileys](https://github.com/WhiskeySockets/Baileys) |
| Backend | Node.js 22.5+ (usa `node:sqlite` nativo) + Express |
| Banco de dados | SQLite (arquivo local, `data/livia.db`) |
| IA (análise de histórico) | Groq API (`llama-3.3-70b-versatile`) |
| Agendamento | node-cron |
| Painel | PWA — HTML/CSS/JS puro, sem framework/build step |
| Deploy | Render (free tier) |

---

## Rodando localmente

### 1. Pré-requisitos
- Node.js **22.5 ou superior** (o projeto usa o módulo nativo `node:sqlite`, não precisa instalar SQLite separado)

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
2. Inicia a conexão com o WhatsApp (Baileys) — gera QR Code se não houver sessão salva em `data/session/`
3. Ativa o cron de lembretes de vencimento (todo dia às 9h, fuso `TZ`)

### 5. Primeiro acesso
1. Abra `http://localhost:3200` e entre com a senha de `ADMIN_PASSWORD` (padrão do exemplo: `livia123`)
2. Vá em **WhatsApp** (menu inferior) e escaneie o QR Code com o celular que vai atender (WhatsApp → Dispositivos Vinculados → Vincular dispositivo)
3. Em **Treinar a Livia**, use "Analisar histórico de conversas" para gerar sugestões de FAQ a partir das mensagens recebidas (requer `GROQ_API_KEY`), ou cadastre respostas manualmente com o botão `+`
4. Em **Clientes**, cadastre clientes com data de vencimento para ativar os lembretes automáticos

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
│   │   └── messageHandler.js     ← pipeline de mensagem recebida (horário → FAQ → fallback)
│   ├── engine/
│   │   ├── faqSearch.js          ← busca por similaridade/proximidade de tokens no FAQ
│   │   └── historyAnalyzer.js    ← lê mensagens do log → agrupa via Groq → grava faq_candidates
│   ├── db/
│   │   ├── db.js                 ← wrapper sobre `node:sqlite` (WAL mode)
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
├── data/                         ← SQLite (`livia.db`) + sessão do Baileys (gitignored)
├── .env.example
├── .gitignore
├── render.yaml                   ← deploy Render (free tier, disco persistente em /data)
├── package.json
└── implementation_plan.md        ← histórico de design e decisões técnicas
```

---

## Deploy no Render

O `render.yaml` já está pronto (`render blueprint`):
- Build: `npm install` / Start: `npm start`
- Disco persistente de 1GB montado em `/data` (guarda o SQLite e a sessão do WhatsApp entre deploys)
- `JWT_SECRET` é gerado automaticamente pelo Render
- `GROQ_API_KEY`, `BUSINESS_NAME`, `OWNER_PHONE`, `ADMIN_PASSWORD` precisam ser preenchidos manualmente no painel do Render (marcados como `sync: false`)

Depois do deploy, acesse a URL do serviço, faça login e escaneie o QR Code novamente (sessão do WhatsApp é por ambiente).

---

## Troubleshooting

- **Editei um arquivo em `frontend/js/` e o navegador continua com o código antigo** — o service worker (`sw.js`) faz cache do shell do PWA. Em desenvolvimento, use aba anônima ou dê "Unregister" no service worker (DevTools → Application → Service Workers) e recarregue.
- **Login não funciona / fica piscando entre painel e tela de login** — verifique se `JWT_SECRET` está definido no `.env` e se os cookies não estão sendo bloqueados (o login usa cookie `httpOnly`, `SameSite=Lax`).
- **"Analisar histórico" não gera nenhuma sugestão** — confira se `GROQ_API_KEY` está preenchida no `.env` e se já existem mensagens recebidas registradas em `messages_log` (o bot precisa ter ficado conectado recebendo mensagens antes).
- **Esqueci a senha do painel** — na tela de login, clique em "Esqueci minha senha" e informe a `RECOVERY_KEY` configurada no `.env` (ou nas variáveis de ambiente do Render) junto com a nova senha.
- **QR Code não aparece** — confira os logs do servidor; se a sessão anterior ficou corrompida, apague a pasta `data/session/` e reinicie.

---

## Licença

Uso interno — sem licença pública definida.
