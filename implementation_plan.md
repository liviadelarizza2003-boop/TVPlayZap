# Plano Final: Eva Lite para Livia (v2 — com Onboarding Inteligente)

> **Status: implementado e verificado.** Este documento registra o design e as decisões
> técnicas do projeto. Para instruções de instalação, execução e deploy, veja o
> [README.md](README.md).

## Visão Geral

Bot WhatsApp + Painel PWA para micro empresas.
Onboarding que **lê o histórico de conversas existente** e gera um FAQ inicial automaticamente.

---

## Fluxo de Onboarding (passo a passo)

```
1. Livia abre o painel pela primeira vez
2. Clica em "Conectar WhatsApp" → escaneia QR Code
3. Clica em "Analisar minhas conversas"
4. O sistema lê TODAS as mensagens recebidas dos últimos X meses
5. A IA (Groq — gratuita) agrupa as mensagens por tema e sugere perguntas + respostas
6. Livia vê o painel "Treinar a Livia" com os cards de sugestões
7. Ela revisa cada card: ✅ Aprovar | ✏️ Editar | ✖ Descartar
8. Os aprovados viram FAQ ativo → bot já começa a responder
```

> [!NOTE]
> Reutilizamos a lógica do `analiseHistorico.js` do Eva, adaptada para gerar **novos** pares pergunta/resposta (não só mapear contra FAQ existente). A IA vai criar o FAQ do zero a partir do histórico.

---

## Funcionalidades

### 🚀 Fase 0 — Onboarding (script único, roda uma vez)
- Conecta via Baileys e baixa histórico de conversas
- Agrupa mensagens de clientes por similaridade semântica
- Para cada grupo: IA gera `pergunta sugerida` + `resposta sugerida`
- Salva como `faq_candidates` com status `pending`

### 🎓 Treinar a Livia (módulo do painel)
- Lista de cards pendentes com pergunta + resposta sugerida pela IA
- Ações por card:
  - **✅ Aprovar** → entra no FAQ ativo imediatamente
  - **✏️ Editar** → campo de texto inline, salva ao confirmar
  - **✖ Descartar** → remove da fila
- Badge de contagem de pendentes no menu
- Livia pode adicionar novas entradas manualmente (botão `+ Nova Resposta`)

### 🤖 Bot WhatsApp (Baileys)
- Busca por similaridade no FAQ (mesmo algoritmo do Eva: `faqSearch.js`)
- Fallback: *"Olá! Vou chamar a Livia para você 😊"*
- Resposta de fora do horário configurável

### ⏰ Lembretes de Vencimento
- Cron às 9h todo dia
- Envia aviso 3 dias antes: *"Oi [Nome]! Seu plano vence dia XX/XX. Quer renovar? 😊"*
- Log de notificações enviadas (evita duplicatas)

### 📱 Painel PWA (instala no Android como app)
- **Dashboard**: Cards de vencimentos próximos (hoje, 3 dias, 7 dias), stats do bot
- **Clientes**: Lista + botão `+ Novo Cliente` com campos: Nome, Telefone, Plano, Vencimento
- **Treinar a Livia**: Cards de aprovação do FAQ (igual ao Eva)
- **QR Code**: Tela de conexão do WhatsApp com QR animado
- **Config**: Horário de atendimento, mensagem de fora do horário, nome do negócio

---

## Stack Tecnológica

| Componente | Tecnologia | Custo |
|---|---|---|
| Bot WhatsApp | **Baileys** (Node.js) | Grátis |
| IA para análise | **Groq API** (llama-3.3-70b) | Grátis |
| Backend | **Node.js + Express** | Grátis |
| Banco de Dados | **SQLite** (arquivo local) | Grátis |
| Agendamento | **node-cron** | Grátis |
| Painel | **PWA** (HTML/CSS/JS puro) | Grátis |
| Hosting | **Render Free Tier** | Grátis |

---

## Estrutura do Projeto

```
C:\Sistemas\livia-bot\
├── src/
│   ├── api/
│   │   ├── server.js
│   │   └── routes/
│   │       ├── auth.js          ← Login por senha única (bcrypt + JWT em cookie httpOnly)
│   │       ├── clients.js       ← CRUD clientes + vencimentos
│   │       ├── faq.js           ← CRUD FAQ + aprovação de candidatas
│   │       ├── onboarding.js    ← Dispara análise do histórico
│   │       └── config.js        ← Configurações do negócio
│   ├── bot/
│   │   ├── index.js             ← Baileys + QR Code via WebSocket
│   │   └── messageHandler.js   ← Busca FAQ, resposta automática
│   ├── engine/
│   │   ├── faqSearch.js         ← Busca por similaridade (do Eva)
│   │   └── historyAnalyzer.js  ← Lê histórico → gera FAQ candidates via IA
│   ├── db/
│   │   ├── db.js                ← SQLite wrapper (`node:sqlite` nativo, WAL mode)
│   │   └── schema.sql           ← Tabelas: clients, faq, faq_candidates, config, renewal_notifications, messages_log
│   └── scheduler/
│       └── renewalReminder.js  ← Cron 3 dias antes do vencimento
├── frontend/
│   ├── index.html               ← PWA Shell com roteamento SPA
│   ├── manifest.json            ← PWA: nome, ícone, cor
│   ├── sw.js                    ← Service Worker (cache offline)
│   ├── icons/                   ← icon-192.png, icon-512.png
│   ├── css/
│   │   └── style.css            ← Design premium dark mode
│   └── js/
│       ├── app.js               ← Roteador SPA + gate de autenticação
│       ├── dashboard.js
│       ├── clients.js
│       ├── training.js          ← "Treinar a Livia"
│       ├── qrcode.js
│       └── config.js
├── data/                        ← SQLite + sessão Baileys (gitignored)
├── .env.example
├── .gitignore
├── package.json
├── render.yaml
├── README.md                    ← instalação, execução e deploy
└── implementation_plan.md       ← este documento
```

---

## Plano de Execução

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `schema.sql` | Tabelas: `clients`, `faq`, `faq_candidates`, `config`, `renewal_notifications`, `messages_log` |
| 2 | `db.js` | SQLite wrapper simples |
| 3 | `engine/historyAnalyzer.js` | Lê histórico Baileys → agrupa → gera FAQ candidates via Groq |
| 4 | `bot/index.js` | Baileys + QR Code via endpoint HTTP |
| 5 | `bot/messageHandler.js` | Recebe mensagem → busca FAQ → responde |
| 6 | `engine/faqSearch.js` | Busca por similaridade (portado do Eva) |
| 7 | `scheduler/renewalReminder.js` | Cron lembretes de vencimento |
| 8 | `api/server.js` + rotas | REST API completa |
| 9 | `frontend/` | PWA completo com design premium |
| 10 | `render.yaml` + `.env.example` | Deploy no Render |

---

## Verificação

Testado ponta a ponta no navegador (login → dashboard → clientes → FAQ/treinar →
configurações) e via scripts diretos contra o banco/engine:

- ✅ Login (senha correta e incorreta) e proteção das rotas autenticadas
- ✅ QR Code gerado e transmitido em tempo real via WebSocket (`/ws/qr`); estado
  "Aguardando scan" confirmado com o bot tentando conectar de verdade
- ✅ Cadastro, listagem e exclusão de cliente (com vencimento) pelo painel
- ✅ Criação manual de entrada de FAQ pelo painel e busca por similaridade
  (`faqSearch.search()`) validada com mensagens de teste — match correto por
  pergunta/keyword e rejeição correta de mensagens não relacionadas
- ✅ Dashboard consumindo `/api/config/stats` e `/api/clients/expiring` com dados reais
- ✅ Ícones do PWA (`icon-192.png`, `icon-512.png`) servidos corretamente
- ⏳ Não testado neste ambiente (requer WhatsApp real): recebimento de mensagem real
  pelo bot, disparo do cron de lembretes em produção, análise de histórico via Groq
  (requer `GROQ_API_KEY` e mensagens acumuladas em `messages_log`), instalação do PWA
  em um Android físico

## Correções pós-implementação

- **Bug crítico de login corrigido** — em `frontend/js/app.js`, o helper `api.*`
  tratava respostas `401` chamando `App.logout()` e retornando `null` em vez de
  lançar exceção. Como `App.init()` decidia entre mostrar o painel ou a tela de
  login com base em um `try/catch`, o `catch` nunca era acionado e o app tentava
  sempre exibir o painel — mesmo sem sessão válida — deixando o botão "Entrar" sem
  o handler de clique (só era conectado dentro de `showLogin()`, nunca chamada).
  Corrigido para o helper de API distinguir a chamada de `/api/auth/login` (deixa o
  erro propagar, mostrando "Senha incorreta") das demais (mostra a tela de login sem
  reload) e para `App.init()` decidir com base no valor de retorno, não só na exceção.
- **Ícones do PWA ausentes** — `manifest.json` e `index.html` referenciavam
  `frontend/icons/icon-192.png` e `icon-512.png`, que não existiam. Gerados via script
  Node (PNG puro, sem dependências) e adicionados à pasta `frontend/icons/`.
- **`.gitignore` adicionado** — projeto ainda não tinha controle de versão; arquivo
  criado para excluir `node_modules/`, `data/` (SQLite + sessão do WhatsApp) e `.env`
  antes de um eventual `git init`.
- **Nota de cache do Service Worker** — durante os testes, alterações em
  `frontend/js/*.js` não apareciam no navegador até desregistrar o Service Worker
  (`sw.js` faz cache-first do shell do PWA). Documentado em README.md → Troubleshooting;
  não é um bug, é o comportamento esperado de um PWA com cache offline.
