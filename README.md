# ⚽ A Bola Maya — Bolão do Mundial 2026

Backend local com Node.js + Express + SQLite. Sem conta externa.

## Arrancar (3 passos)

```bash
npm install
npm start
```

Abre **http://localhost:3000** no browser.

A base de dados (`abolamaya.db`) é criada automaticamente com todos os 72 jogos.

---

## Admin (introduzir resultados)

1. Cria a tua conta normalmente em http://localhost:3000
2. Corre no terminal:
   ```bash
   node server/make-admin.js o_teu_username
   ```
3. Vai a http://localhost:3000/admin.html
4. **"Resultados"** → introduz marcador → "Guardar" → pontos calculados automaticamente para todos
5. **"Pontos de Grupos"** → quando todos os 6 jogos de um grupo terminarem → "Calcular pontos"

---

## Salas privadas

- Cria uma sala em **Salas** e partilha o código de 6 letras
- Cada sala tem a sua classificação
- Podes estar em várias salas

---

## API-Football (dados em tempo real)

Integração com [API-Football](https://www.api-sports.io/) para forma recente e jogos ao vivo.

### Configuração

Cria um ficheiro `.env` na raiz do projeto (já está no `.gitignore`):

```
API_FOOTBALL_KEY=a_tua_chave_aqui
JWT_SECRET=muda_isto_em_producao
PORT=3000
```

### Endpoints disponíveis

| Endpoint | Descrição | Cache |
|---|---|---|
| `GET /api/football/form?team=Portugal` | Últimos 5 resultados (W/D/L) | 6 h |
| `GET /api/football/stats?team=Portugal&league=1&season=2026` | Estatísticas no Mundial | 6 h |
| `GET /api/football/live` | Jogos ao vivo neste momento | 60 s |

`league` e `season` têm default `1` e `2026`, pelo que `?team=Portugal` chega para o Mundial.

---

## Scraper de Resultados (Soccerway)

Scrapar os últimos 5 resultados de cada seleção directamente do Soccerway, sem depender de quotas de API.

### Setup (uma vez)

```bash
npx playwright install chromium
```

Isto descarrega o Chromium (~150 MB) usado pelo Playwright.

### Como funciona

- **Ao arrancar o servidor** — corre um scrape completo das 48 seleções automaticamente (após 5 s)
- **A cada 12 horas** — scrape completo às 06:00 e 18:00 UTC
- **Dias de jogo** — checks extra entre as 00:00 e as 10:00 UTC sempre que houver jogos do Mundial que terminaram nas últimas 3–7 h

Os resultados ficam guardados na tabela `team_results` do SQLite. Se um scrape falhar, os dados anteriores mantêm-se intactos.

### Endpoint de resultados

```
GET /api/national-teams/:slug/results
```

Devolve os últimos 5 resultados em cache para a seleção com esse slug (ex: `portugal`, `argentina`).

### Acionar manualmente (admin)

```
POST /api/national-teams/scrape              # scrape das 48 seleções
POST /api/national-teams/:slug/scrape        # scrape de uma seleção específica
```

### Corrigir um URL do Soccerway

Se uma seleção aparecer nos logs como **"no results found (URL may be wrong)"**:

1. Vai a [us.soccerway.com](https://us.soccerway.com), procura a seleção nacional
2. Copia o URL (ex: `https://us.soccerway.com/teams/europe/portugal/14/`)
3. Actualiza a entrada correspondente em `server/scraper/teams.js`
4. Chama `POST /api/national-teams/:slug/scrape` para re-scrape sem reiniciar o servidor

---

## Estrutura

```
abolamaya/
├── server/
│   ├── index.js              # Express app (porta 3000)
│   ├── db.js                 # SQLite + schema + 72 fixtures
│   ├── config.js             # JWT secret, porta, API_FOOTBALL_KEY
│   ├── make-admin.js         # Script para tornar user admin
│   ├── middleware/
│   │   └── auth.js           # JWT middleware
│   ├── scraper/
│   │   ├── teams.js          # 48 seleções com URLs do Soccerway
│   │   ├── soccerway.js      # Playwright scraper
│   │   └── scheduler.js      # Cron 12h + extras dias de jogo
│   └── routes/
│       ├── auth.js           # POST /api/auth/register|login
│       ├── matches.js        # GET/POST /api/matches(/predictions)
│       ├── leaderboard.js    # GET /api/leaderboard(/lobby/:id)
│       ├── lobbies.js        # CRUD /api/lobbies
│       ├── admin.js          # POST /api/admin/result|group/:id/points
│       ├── football.js       # Proxy API-Football (form, stats, live)
│       └── national-teams.js # GET /api/national-teams/:slug/results
├── js/
│   ├── api.js                # Cliente REST (wraps fetch)
│   ├── auth.js               # requireAuth, logout, helpers
│   ├── config.js             # Deadline + constantes
│   └── scoring.js            # calcStandings, compareStandings (regras FIFA)
├── css/style.css
├── .env                      # Chaves (não vai para git)
├── .env.example              # Template das variáveis de ambiente
├── index.html                # Login / Registo
├── dashboard.html            # Página principal
├── predict.html              # Fazer previsões (72 jogos)
├── leaderboard.html          # Classificação global + por sala
├── lobby.html                # Salas privadas
├── team.html                 # Página da seleção (plantel + forma recente)
└── admin.html                # Inserir resultados + calcular pontos
```

## Pontuação

| Evento | Pontos |
|--------|--------|
| Resultado certo (V/E/D) | 1 |
| Marcador exato | 3 |
| Cada posição certa na tabela de grupo | 1 (máx. 4 por grupo) |

As tabelas de grupo são calculadas automaticamente a partir dos marcadores que previste (regras FIFA: pontos → diferença de golos → golos marcados).
