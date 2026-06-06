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
| Upload de ficheiros | multer + sharp |
| Passwords | bcryptjs (salt 10) |
| Emails | Resend HTTP API (fetch nativo, sem SMTP) |
| Segurança | helmet, express-rate-limit |

---

## Estrutura de Ficheiros

```
abolamaya/
│
├── server/                        # Backend Node.js
│   ├── index.js                   # Express app, helmet, rate limiting, 404/error handlers
│   ├── db.js                      # SQLite: schema, inicialização, migrações
│   ├── config.js                  # JWT_SECRET (obrigatório ≥32 chars), BASE_URL, SMTP, OAuth
│   ├── email.js                   # Resend HTTP API (fetch); fallback consola em dev
│   ├── make-admin.js              # CLI: promover utilizador a admin
│   ├── settle.js                  # Liquidar previsões a partir de resultados scraped
│   │
│   ├── middleware/
│   │   ├── auth.js                # JWT (auth, requireAdmin, optionalAuth) + check banned
│   │   └── achievements.js        # Atribuir achievements após acções
│   │
│   ├── routes/
│   │   ├── auth.js                # Registo, login, forgot-password, reset-password
│   │   ├── oauth.js               # Callbacks Google & GitHub OAuth
│   │   ├── matches.js             # Fixtures, previsões (GET/POST)
│   │   ├── leaderboard.js         # Rankings global e por lobby (inclui avatar_url)
│   │   ├── admin.js               # Resultados, pontos de grupo, gestão de utilizadores
│   │   ├── lobbies.js             # Criar/entrar/sair/kick de salas privadas
│   │   ├── profile.js             # Perfis, stats, histórico, privacy
│   │   ├── friends.js             # Amizades (friend request ID em notificação para accept inline)
│   │   ├── notifications.js       # Notificações in-app
│   │   ├── national-teams.js      # Status de scraping por seleção
│   │   ├── football.js            # Proxy API-Football
│   │   ├── playerStats.js         # Estatísticas de jogadores (Soccerway)
│   │   ├── tickets.js             # Reportes/suporte
│   │   └── upload.js              # Upload de avatares (AVATARS_DIR env var)
│   │
│   └── scraper/
│       ├── scheduler.js           # Cron jobs; SKIP_STARTUP_SCRAPE para Railway
│       ├── teams.js               # 48 selecções com resultsUrl/squadUrl overrides (ex: USA)
│       ├── soccerway.js           # Scraper Playwright; container-first para resultsUrl teams;
│       │                          # suporta datas DD.MM.YYYY e DD.MM. HH:MM (www.soccerway.com)
│       └── playerStatsSoccerway.js # Stats de jogadores por equipa
│
├── js/
│   ├── api.js                     # Cliente REST com JWT
│   ├── auth.js                    # Guards, navbar, notificações (accept friend inline), helpers
│   ├── config.js                  # Deadline, labels de grupos, cor de avatar
│   ├── scoring.js                 # calcStandings, compareStandings (regras FIFA)
│   └── theme.js                   # Dark/light mode
│
├── css/style.css                  # Design completo, responsivo
├── data/squads/                   # JSON por seleção
├── img/                           # Logos, bandeiras, troféus
│
├── index.html                     # Login / Registo (checkbox termos, link "Esqueceste a password?")
├── dashboard.html                 # Painel principal (leaderboard com nomes clicáveis para perfis)
├── predict.html                   # 72 jogos com inputs de marcador
├── leaderboard.html               # Leaderboards global e por lobby (fotos de perfil)
├── lobby.html                     # Salas privadas + kick de membros
├── team.html                      # Plantel e forma de uma seleção
├── profile.html                   # Perfil público (67machine: "Membro desde o primeiro dia")
├── settings.html                  # Definições de conta + link para reportar
├── admin.html                     # 5 tabs: Resultados, Grupos, Seleções, Reportes (modal), Utilizadores
├── oauth.html                     # Redirect handler OAuth
├── forgot-password.html           # Pedido de recuperação de password
├── reset-password.html            # Definição de nova password (token da URL)
├── about.html                     # Sobre o projeto
├── information.html               # Fontes de dados
├── support.html                   # Formulário de reporte
├── terms.html                     # Termos & Privacidade
├── 404.html                       # Página 404 personalizada
│
├── Dockerfile                     # mcr.microsoft.com/playwright:v1.60.0-noble + node directo
├── .dockerignore                  # Exclui node_modules, .env, db local, avatars
├── nixpacks.toml                  # Fallback Nixpacks (Railway)
└── server/import-player-stats*.js # Scripts de export/import de stats via JSON
```

---

## Base de Dados (SQLite)

### Tabelas Principais

**`users`** — `id, username, display_name, email, password_hash, is_admin, banned, bio, avatar_color, avatar_url, profile_public, history_public, created_at`

**`matches`** — 72 jogos da fase de grupos: `id, group_id (A–L), home_team, away_team, flags, match_date, match_time (hora PT), venue, home_score, away_score, status`

**`match_predictions`** — `user_id, match_id, home_score, away_score, points_earned (NULL=por liquidar), created_at, updated_at`

**`group_points`** — `user_id, group_id, predicted_order (JSON), actual_order (JSON), points_earned (0–4), calculated_at`

**`lobbies`** — `id, name, invite_code (6 letras), created_by, created_at`

**`lobby_members`** — `lobby_id, user_id, joined_at`

**`team_results`** — Resultados scraped do Soccerway: `team_code, match_date, home_team, away_team, scores, result_for_team, scraped_at`

**`password_reset_tokens`** — `id, user_id, token_hash (SHA-256), expires_at (1h), used_at (NULL=não usado), created_at`

**`tickets`** — Reportes: `id, user_id (nullable), category, title, description, page_url, reference, status (open/reviewing/resolved), created_at, updated_at`

### Tabelas de Suporte

`user_oauth`, `user_achievements`, `notifications`, `friends`, `settlement_log`, `player_national_stats`, `schema_version`

---

## Sistema de Pontuação

| Situação | Pontos |
|---|---|
| Resultado correcto (V/E/D) | 1 ponto |
| Marcador exacto | 3 pontos (substitui o de resultado) |
| Posição correcta no grupo | 1 ponto cada (máx. 4 por grupo) |

Pontos de grupo calculados após todos os 6 jogos do grupo terminarem, com regras FIFA (V=3, E=1, D=0; desempate: DG → golos → alfabético).

Ranking: total → pts jogo → username.

---

## Funcionalidades

### Autenticação & Recuperação de Password
- Email + Password (bcrypt salt 10, JWT 30 dias)
- OAuth Google & GitHub (state param JWT 10min, anti-CSRF)
- **Recuperação de password**: `POST /api/auth/forgot-password` (token SHA-256, expira 1h, uso único, resposta sempre genérica) + `POST /api/auth/reset-password`
- Email enviado via **Resend HTTP API** (sem SMTP); sem `RESEND_API_KEY` o link aparece na consola em dev
- Contas banidas bloqueadas no login e em cada pedido autenticado
- JWT_SECRET obrigatório no `.env` com ≥ 32 chars — servidor não arranca sem ele

### Previsões
- Deadline: 11 Jun 2026 às 18:00 UTC — bloqueado no client e server
- Batch upsert numa transacção; ON CONFLICT actualiza sem duplicar

### Admin Panel (5 tabs)
- **Resultados**: Introduzir marcadores manualmente
- **Pontos de Grupo**: Calcular após o grupo terminar
- **Seleções**: Estado do scraping, scrape manual, stats de jogadores
- **Reportes**: Lista clicável — clicar abre modal com detalhes completos, descrição, info do utilizador e selector de estado
- **Utilizadores**: Pesquisa em tempo real (username/email/nome), ticket count (laranja ≥3, vermelho ≥5), ban/reativar, apagar conta

### Notificações
- Bell na navbar com badge de não lidas
- **Pedidos de amizade**: mostram botão "Aceitar" e "Ver perfil" inline — aceitar sem sair da página
- Outros tipos (achievement, match_settled, friend_accepted): link directo

### Lobbies
- Código convite de 6 letras; criador pode expulsar membros e apagar; leaderboard próprio

### Fotos de Perfil
- Upload via multer + sharp (resize 200×200, JPEG 85%)
- Guardadas em `AVATARS_DIR` env var (Railway: `/data/avatars`); servidas em `/img/avatars/*`
- Sem `AVATARS_DIR`, guarda em `img/avatars/` local (dev)
- Leaderboard e dashboard mostram foto real quando disponível

### Páginas de Transparência
`about.html`, `information.html`, `support.html`, `terms.html` — navbar opcional quando autenticado; footer em todas as páginas

---

## Rate Limiting

| Endpoint | Limite |
|---|---|
| Todos `/api/auth/*` | 20 req / 15 min por IP |
| `POST /api/auth/forgot-password` | + 5 req / hora por IP |
| `POST /api/auth/reset-password` | + 10 req / hora por IP |
| `POST /api/tickets` | 10 req / hora por IP |

Abuso de forgot-password: cooldown 10 min por conta + máx. 3 emails/conta/hora.

---

## Segurança

| Área | Implementação |
|---|---|
| Passwords | bcryptjs salt 10 |
| JWT | ≥32 chars obrigatório; is_admin e banned lidos da DB em cada pedido |
| Reset de password | Token 32 bytes aleatórios; só SHA-256 na DB; expira 1h; uso único |
| Rate limiting | auth + forgot + reset + tickets |
| Headers | helmet (X-Frame-Options, X-Content-Type-Options, etc.) |
| SQL injection | Todas as queries parametrizadas (better-sqlite3) |
| Uploads | MIME type validation + 5MB limit + sharp processing |
| Erros | Stack traces nunca expostos ao cliente |
| Proxy | `trust proxy: 1` para Railway (X-Forwarded-For correcto) |

---

## Scraping (Soccerway + Playwright)

### Resultados
- 3 estratégias de parsing por ordem: container-first (para teams com `resultsUrl`) → body text state machine → HTML table legado
- Suporta formatos de data: `Apr 01`, `Nov 16, 2025`, `DD/MM/YYYY`, `DD.MM.YYYY`, `DD.MM. HH:MM`
- `resultsUrl` override por equipa quando URL diverge do padrão (ex: USA usa `www.soccerway.com`)
- `squadUrl` override para scraping de stats de jogadores

### Agendamento
| Quando | O quê |
|---|---|
| Startup | Scrape completo se cache desatualizada (skip com `SKIP_STARTUP_SCRAPE=true`) |
| 06:00 e 18:00 UTC | Scrape completo das 48 selecções |
| 00:00–10:00 UTC (horário) | Só equipas com jogos terminados há 3–7 horas |

### Auto-settle
Após cada scrape, cruza resultados com jogos do Mundial por data + equipas. Só liquida `points_earned IS NULL`.

---

## API Endpoints

### Auth
```
POST /api/auth/register
POST /api/auth/login
POST /api/auth/forgot-password   (resposta sempre genérica)
POST /api/auth/reset-password
GET  /api/auth/google  /api/auth/github  (OAuth)
GET  /api/me
```

### Jogos, Leaderboard, Lobbies
```
GET  /api/matches
GET  /api/matches/predictions
POST /api/matches/predictions    (batch upsert)
GET  /api/leaderboard
GET  /api/leaderboard/lobby/:id
GET/POST/DELETE /api/lobbies/*
DELETE /api/lobbies/:id/members/:uid   (kick, criador only)
```

### Admin
```
GET    /api/admin/stats
POST   /api/admin/result
POST   /api/admin/group/:id/points
POST   /api/admin/auto-settle
GET    /api/admin/users              (+ ticket_count)
PATCH  /api/admin/users/:id/ban
DELETE /api/admin/users/:id
GET    /api/tickets/admin
PATCH  /api/tickets/admin/:id/status
```

### Perfil, Amigos, Notificações, Tickets
```
GET   /api/profile/:username
PATCH /api/profile/me  /me/password  /me/privacy  /me/username
GET/POST/DELETE /api/friends/*
GET/PATCH /api/notifications/*
POST  /api/tickets
POST  /api/upload/avatar
DELETE /api/upload/avatar
```

---

## Configuração (.env)

```bash
# Obrigatório
JWT_SECRET=<string aleatória ≥ 32 chars>
# node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# Recomendado em produção
PORT=3000
BASE_URL=https://o-teu-dominio.com
NODE_ENV=production
DB_PATH=/data/abolamaya.db          # Railway volume
AVATARS_DIR=/data/avatars            # Railway volume (mesma pasta)
SKIP_STARTUP_SCRAPE=true             # evita OOM no arranque

# Emails (Resend)
RESEND_API_KEY=re_xxxxxxxxxxxx
EMAIL_FROM=A Bola Maya <onboarding@resend.dev>

# OAuth (opcional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# API-Football (opcional, forma das seleções)
API_FOOTBALL_KEY=
```

---

## Como Correr

```bash
npm install
npx playwright install chromium

npm run dev    # desenvolvimento (nodemon)
npm start      # produção

node server/make-admin.js <username>

# Exportar/importar stats de jogadores
npm run export:player-stats
npm run import:player-stats-json   # com DB_PATH definido
```

---

## Deploy (Railway)

**Dockerfile**: usa `mcr.microsoft.com/playwright:v1.60.0-noble` (Chromium incluído). CMD usa `node server/index.js` directamente (SIGTERM vai directo ao processo, não passa pelo npm).

**Volume**: montar em `/data`. Definir `DB_PATH=/data/abolamaya.db` e `AVATARS_DIR=/data/avatars`.

**Variáveis obrigatórias no Railway**:
```
JWT_SECRET, BASE_URL, NODE_ENV=production,
DB_PATH=/data/abolamaya.db, AVATARS_DIR=/data/avatars,
SKIP_STARTUP_SCRAPE=true,
RESEND_API_KEY, EMAIL_FROM
```

**Easter egg**: `@67machine` vê "Membro desde o primeiro dia" no perfil.
