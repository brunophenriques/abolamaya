# A Bola Maya — Documentação Completa do Projeto

> Jogo de predictions para o Mundial 2026 (FIFA World Cup 2026)

---

## O que é este projeto?

**A Bola Maya** é uma aplicação web full-stack de predictions de futebol para o Mundial 2026. Os utilizadores registam-se, fazem as suas previsões para os 72 jogos da fase de grupos (marcadores exactos e classificações dos grupos), e acumulam pontos conforme os resultados reais.

Tem funcionalidades sociais (lobbies privados, amigos, leaderboards), um painel de administração completo (resultados, gestão de utilizadores, tickets de suporte), e um sistema de web scraping automático que vai buscar resultados e estatísticas de jogadores ao Soccerway com Playwright.

---

## Stack Tecnológica

| Camada | Tecnologia |
|---|---|
| Backend | Node.js + Express 4.x |
| Base de dados | SQLite (better-sqlite3, WAL mode) |
| Frontend | HTML + CSS + Vanilla JavaScript |
| Autenticação | JWT (30 dias) + OAuth (Google & GitHub) |
| Scraping | Playwright (headless Chromium) |
| Agendamento | node-cron |
| Upload de ficheiros | multer |
| Passwords | bcryptjs (salt 10) |
| Emails | nodemailer (SMTP + fallback consola em dev) |
| Segurança | helmet, express-rate-limit |

---

## Estrutura de Ficheiros

```
abolamaya/
│
├── server/                        # Backend Node.js
│   ├── index.js                   # Ponto de entrada, Express app, helmet, rate limiting, 404/error handlers
│   ├── db.js                      # SQLite: schema, inicialização, migrações
│   ├── config.js                  # JWT_SECRET (obrigatório ≥32 chars), BASE_URL, SMTP, OAuth keys
│   ├── email.js                   # Serviço de email: nodemailer + fallback consola em dev
│   ├── make-admin.js              # CLI: promover utilizador a admin
│   ├── settle.js                  # Liquidar previsões a partir de resultados scraped
│   │
│   ├── middleware/
│   │   ├── auth.js                # JWT middleware (auth, requireAdmin, optionalAuth) + check banned
│   │   └── achievements.js        # Verificar e atribuir achievements após acções
│   │
│   ├── routes/
│   │   ├── auth.js                # Registo, login, forgot-password, reset-password
│   │   ├── oauth.js               # Callbacks Google & GitHub OAuth
│   │   ├── matches.js             # Fixtures, previsões (GET/POST)
│   │   ├── leaderboard.js         # Rankings global e por lobby
│   │   ├── admin.js               # Resultados, pontos de grupo, gestão de utilizadores
│   │   ├── lobbies.js             # Criar/entrar/sair/kick de salas privadas
│   │   ├── profile.js             # Perfis, stats, histórico, privacy
│   │   ├── friends.js             # Pedidos de amizade, amigos, leaderboard amigos
│   │   ├── notifications.js       # Sistema de notificações in-app
│   │   ├── national-teams.js      # Status de scraping por seleção
│   │   ├── football.js            # Proxy para API-Football (forma, live, stats)
│   │   ├── playerStats.js         # Estatísticas de jogadores (Soccerway)
│   │   ├── tickets.js             # Sistema de reportes/suporte
│   │   └── upload.js              # Upload de avatares (multer)
│   │
│   └── scraper/
│       ├── scheduler.js           # Cron jobs: scrapes 12h + checks de jornada
│       ├── teams.js               # 48 selecções com URLs Soccerway, aliases e squadUrl overrides
│       ├── soccerway.js           # Scraper Playwright (resultados por equipa)
│       └── playerStatsSoccerway.js # Scraper de stats de jogadores por equipa
│
├── js/                            # JavaScript do lado do cliente
│   ├── api.js                     # Cliente REST com JWT e gestão de erros
│   ├── auth.js                    # Guards de login, navbar, notificações, helpers
│   ├── config.js                  # Deadline, labels de grupos, cor de avatar
│   ├── scoring.js                 # calcStandings, compareStandings (regras FIFA)
│   └── theme.js                   # Toggle dark/light mode
│
├── css/
│   └── style.css                  # Design completo, responsivo (desktop + mobile)
│
├── data/
│   └── squads/                    # JSON por seleção: jogadores, posições, clubes
│
├── img/                           # Logos, bandeiras, troféus
│
├── index.html                     # Login / Registo (checkbox de termos, link "Esqueceste a password?")
├── dashboard.html                 # Painel principal do utilizador
├── predict.html                   # 72 jogos com inputs de marcador, filtro por grupo
├── leaderboard.html               # Leaderboards global e por lobby
├── lobby.html                     # Criar / entrar em salas, kick de membros
├── team.html                      # Plantel e forma de uma seleção
├── profile.html                   # Perfil público de utilizador
├── settings.html                  # Definições de conta + link para reportar
├── admin.html                     # Painel admin: resultados, grupos, seleções, reportes, utilizadores
├── oauth.html                     # Redirect handler OAuth
├── forgot-password.html           # Formulário de pedido de recuperação de password
├── reset-password.html            # Formulário de definição de nova password (lê token da URL)
├── about.html                     # Sobre o projeto, afiliações, regras de pontuação
├── information.html               # Fontes de dados, avisos sobre Soccerway
├── support.html                   # Formulário de reporte de problemas
├── terms.html                     # Termos de utilização & privacidade
└── 404.html                       # Página de erro 404 personalizada
```

---

## Base de Dados (SQLite)

### Tabelas Principais

**`users`** — Contas de utilizador
```
id, username (único), display_name, email (único), password_hash
is_admin, banned, bio, avatar_color, avatar_url
profile_public, history_public, created_at
```

**`matches`** — 72 jogos da fase de grupos do Mundial 2026
```
id, group_id (A–L), home_team, away_team, home_flag, away_flag
match_date, match_time (hora PT), venue
home_score, away_score  →  NULL até o jogo acabar
status: 'scheduled' | 'live' | 'finished'
```

**`match_predictions`** — Previsões de cada utilizador por jogo
```
user_id, match_id, home_score, away_score
points_earned  →  NULL = por liquidar | 0–3 = liquidado
created_at, updated_at
```

**`group_points`** — Pontos pela classificação de grupo
```
user_id, group_id
predicted_order (JSON array), actual_order (JSON array)
points_earned (0–4), calculated_at
```

**`lobbies`** — Salas privadas
```
id, name, invite_code (6 letras, único), created_by, created_at
```

**`lobby_members`** — Membros de cada sala
```
lobby_id, user_id, joined_at
```

**`team_results`** — Resultados scraped do Soccerway
```
team_code, team_name, match_date
home_team, away_team, home_score, away_score
result_for_team (W/D/L), team_is_home, scraped_at
```

**`password_reset_tokens`** — Tokens de recuperação de password
```
id, user_id, token_hash (SHA-256 — nunca o token original)
expires_at (1 hora), used_at (NULL = não usado), created_at
```

**`tickets`** — Reportes de utilizadores
```
id, user_id (nullable — anónimo ou autenticado), category, title, description
page_url, reference, status (open/reviewing/resolved)
created_at, updated_at
```

### Tabelas de Suporte

| Tabela | Para quê |
|---|---|
| `user_oauth` | Ligar contas Google/GitHub ao user |
| `user_achievements` | Badges desbloqueados (tipo + data) |
| `notifications` | Notificações in-app (pedidos, achievements, resultados) |
| `friends` | Relações de amizade (pending / accepted) |
| `settlement_log` | Auditoria de liquidações de previsões |
| `player_national_stats` | Stats de jogadores scraped do Soccerway |
| `schema_version` | Controlo de versão do schema / migrações |

---

## Sistema de Pontuação

### Pontos por Jogo
| Situação | Pontos |
|---|---|
| Resultado correcto (vitória/empate/derrota) | 1 ponto |
| Marcador exacto | 3 pontos (substitui o ponto de resultado) |

### Pontos de Grupo
Calculados depois de todos os 6 jogos de um grupo terminarem:
1. Calcula classificação prevista (FIFA rules: vitória=3, empate=1, derrota=0; desempate: DG → golos marcados → alfabético)
2. Compara com classificação real
3. **1 ponto por equipa correctamente posicionada** (máximo 4 por grupo)

### Ranking
Total de pontos → pontos de jogo → username alfabético

---

## Funcionalidades

### Autenticação & Recuperação de Password
- **Email + Password:** bcrypt (salt 10) + JWT 30 dias
- **OAuth:** Google e GitHub (fluxo stateless com JWT como state param, expira em 10 min)
- **Recuperação de password:**
  - `POST /api/auth/forgot-password` — gera token de 32 bytes, guarda só o SHA-256, envia email com link; responde sempre com mensagem genérica
  - `POST /api/auth/reset-password` — valida token (hash + expiração + uso único), actualiza password, invalida token
  - Email enviado com nodemailer; sem SMTP configurado o link aparece na consola (dev only)
- **Admin:** `node server/make-admin.js <username>` pelo terminal
- **Contas banidas:** bloqueadas no login e em cada pedido autenticado (middleware lê `banned` da DB)
- O JWT_SECRET é obrigatório no `.env` com mínimo 32 chars — o servidor não arranca sem ele

### Previsões
- **Deadline:** 11 de Junho de 2026 às 18:00 UTC — bloqueado no client e server após essa hora
- Batch upsert por transacção; ON CONFLICT actualiza sem duplicar

### Admin Panel (5 tabs)
- **Resultados:** Introduzir marcadores manualmente
- **Pontos de Grupo:** Calcular e atribuir após o grupo terminar
- **Seleções:** Estado do scraping, scrape manual, stats de jogadores
- **Reportes:** Lista de tickets com filtro por estado; utilizadores com muitos tickets realçados a laranja/vermelho
- **Utilizadores:** Pesquisa em tempo real, ticket count, ban/reativar, apagar conta

### Rate Limiting

| Endpoint | Limite |
|---|---|
| Todos os `/api/auth/*` | 20 req / 15 min por IP |
| `POST /api/auth/forgot-password` | 5 req / hora por IP (adicional) |
| `POST /api/auth/reset-password` | 10 req / hora por IP (adicional) |
| `POST /api/tickets` | 10 req / hora por IP |

### Tratamento de Erros & 404
- Rotas `/api/*` inexistentes → JSON `{ error: "Rota não encontrada." }` com status 404
- Qualquer outra URL inexistente → serve `404.html` (design consistente com o site)
- Handler global de erros → erros internos nunca expõem stack traces; `console.error` no servidor
- Mensagens de erro internas sanitizadas em todos os endpoints (auth, upload, OAuth)

### Lobbies Privados
- Código de convite de 6 letras único; criador pode expulsar membros e apagar o lobby
- Leaderboard próprio por lobby; qualquer membro pode sair

### Sistema de Reportes (Tickets)
- Categorias: resultado errado, stat de jogador, login, previsões, bug visual, outro
- Funciona sem login (anónimo) ou autenticado
- Spam de tickets → ban (política nos Termos)

### Páginas de Transparência
| Página | Conteúdo |
|---|---|
| `about.html` | Projeto, afiliações, regras de pontuação |
| `information.html` | Fontes de dados, avisos sobre totais Soccerway |
| `support.html` | Formulário de reporte (público) |
| `terms.html` | Sem cookies de tracking, email apenas anti-spam, direito de ban/apagar contas |

Registo requer aceitar os Termos (checkbox). Páginas públicas mostram navbar autenticada se o utilizador estiver com sessão iniciada.

---

## API Endpoints

### Auth
```
POST /api/auth/register          Criar conta
POST /api/auth/login             Login email/password
POST /api/auth/forgot-password   Pedir link de recuperação (sempre resposta genérica)
POST /api/auth/reset-password    Definir nova password com token
GET  /api/auth/google            OAuth Google
GET  /api/auth/github            OAuth GitHub
GET  /api/me                     Dados do utilizador autenticado
```

### Jogos e Previsões
```
GET  /api/matches                Todos os 72 jogos
GET  /api/matches/predictions    Previsões do utilizador actual
POST /api/matches/predictions    Guardar previsões (batch upsert)
```

### Admin
```
GET    /api/admin/stats                  Estatísticas gerais
POST   /api/admin/result                 Definir marcador
POST   /api/admin/group/:id/points       Calcular pontos de grupo
POST   /api/admin/auto-settle            Liquidar com resultados scraped
GET    /api/admin/users                  Lista de utilizadores (com ticket count)
PATCH  /api/admin/users/:id/ban          Toggle ban
DELETE /api/admin/users/:id              Apagar conta
GET    /api/tickets/admin                Lista de tickets
PATCH  /api/tickets/admin/:id/status     Actualizar estado
```

### Leaderboard, Lobbies, Perfil, Amigos, Notificações, Tickets
```
GET    /api/leaderboard                    Ranking global
GET    /api/leaderboard/lobby/:id          Ranking de lobby
GET/POST/DELETE /api/lobbies/*             CRUD de salas
DELETE /api/lobbies/:id/members/:uid       Expulsar membro (criador only)
GET    /api/profile/:username              Perfil + stats + achievements
PATCH  /api/profile/me/*                   Actualizar perfil/password/privacy/username
GET/POST/DELETE /api/friends/*             Amizades
GET/PATCH /api/notifications/*             Notificações
POST   /api/tickets                        Submeter reporte (auth opcional)
```

---

## Configuração

### .env
```bash
# Obrigatório
JWT_SECRET=<string aleatória ≥ 32 chars>
# Gera com: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Recomendado
PORT=3000
BASE_URL=http://localhost:3000        # em produção: https://o-teu-dominio.com

# API-Football (forma das seleções, fallback)
API_FOOTBALL_KEY=<chave api-sports.io>

# SMTP (emails de recuperação de password)
# Sem isto o link aparece na consola em dev; em produção os emails não são enviados
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=o.teu@gmail.com
SMTP_PASS=<app-password>              # Gmail: myaccount.google.com → App Passwords
SMTP_FROM=A Bola Maya <noreply@gmail.com>

# OAuth (opcional — desativa o provider se ficar em branco)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

### Deadline
**11 de Junho de 2026 às 18:00 UTC** — hardcoded em `server/config.js` e `js/config.js`.

---

## Como Correr

```bash
npm install                              # instala todas as dependências
npx playwright install chromium          # necessário para o scraper

npm run dev                              # desenvolvimento (nodemon, auto-reload)
npm start                                # produção

node server/make-admin.js <username>     # promover utilizador a admin
```

Base de dados `abolamaya.db` criada automaticamente na primeira execução com os 72 jogos.
Aceder em: `http://localhost:3000`

---

## Segurança

| Área | Implementação |
|---|---|
| Passwords | bcryptjs salt 10 |
| JWT | Assinado com JWT_SECRET (≥32 chars obrigatório); servidor não arranca sem ele |
| Sessão | `is_admin` e `banned` lidos da DB em cada pedido — nunca valores stale do JWT |
| Contas banidas | Bloqueadas no login E em cada pedido autenticado |
| OAuth | State param JWT de 10 min (anti-CSRF) |
| Reset de password | Token de 32 bytes aleatórios; só SHA-256 na DB; expira 1h; uso único |
| Rate limiting | Auth: 20/15min; forgot-password: 5/h; reset-password: 10/h; tickets: 10/h |
| Headers de segurança | helmet (X-Frame-Options, X-Content-Type-Options, etc.) |
| SQL injection | Todas as queries parametrizadas com better-sqlite3 |
| Input | Limites de tamanho em todos os campos de texto; erros internos nunca expostos |
| Uploads | Validação de MIME type + limite 5MB; ficheiro processado com sharp antes de guardar |
| Admins | Protegidos contra ban/delete por outros admins via painel |
| Erros | Stack traces nunca enviados ao cliente; `console.error` no servidor |

---

## Scraping

### Soccerway Scraper (Playwright)
- Resultados recentes por seleção (últimos 5, qualquer competição)
- Stats de jogadores: jogos, golos, assistências, cartões, clean sheets
- `squadUrl` override por equipa para URLs que divergem do padrão (ex: USA)

### Agendamento
| Quando | O quê |
|---|---|
| Startup (5s delay) | Scrape completo se cache desatualizada (< 90% equipas actualizadas em 12h) |
| 06:00 e 18:00 UTC | Scrape completo das 48 selecções |
| 00:00–10:00 UTC (de hora a hora) | Só equipas com jogos terminados há 3–7 horas |

### Auto-settle
Após cada scrape, cruza resultados com os jogos do Mundial por data + equipas.
Só liquida previsões onde `points_earned IS NULL` — sem double-scoring.
