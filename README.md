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

## Estrutura

```
abolamaya/
├── server/
│   ├── index.js          # Express app (porta 3000)
│   ├── db.js             # SQLite + schema + 72 fixtures
│   ├── config.js         # JWT secret, porta
│   ├── make-admin.js     # Script para tornar user admin
│   ├── middleware/
│   │   └── auth.js       # JWT middleware
│   └── routes/
│       ├── auth.js       # POST /api/auth/register|login
│       ├── matches.js    # GET/POST /api/matches(/predictions)
│       ├── leaderboard.js# GET /api/leaderboard(/lobby/:id)
│       ├── lobbies.js    # CRUD /api/lobbies
│       └── admin.js      # POST /api/admin/result|group/:id/points
├── js/
│   ├── api.js            # Cliente REST (wraps fetch)
│   ├── auth.js           # requireAuth, logout, helpers
│   ├── config.js         # Deadline + constantes
│   └── scoring.js        # calcStandings, compareStandings (regras FIFA)
├── css/style.css
├── index.html            # Login / Registo
├── dashboard.html        # Página principal
├── predict.html          # Fazer previsões (72 jogos)
├── leaderboard.html      # Classificação global + por sala
├── lobby.html            # Salas privadas
└── admin.html            # Inserir resultados + calcular pontos
```

## Pontuação

| Evento | Pontos |
|--------|--------|
| Resultado certo (V/E/D) | 1 |
| Marcador exato | 3 |
| Cada posição certa na tabela de grupo | 1 (máx. 4 por grupo) |

As tabelas de grupo são calculadas automaticamente a partir dos marcadores que previste (regras FIFA: pontos → diferença de golos → golos marcados).
