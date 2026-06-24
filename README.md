# A Bola Maya

Aplicacao full-stack de previsoes para o Mundial 2026, construída com Node.js,
Express, SQLite e frontend em HTML/CSS/JavaScript.

## Arranque local

```bash
npm install
npm start
```

O site fica disponivel em `http://localhost:3000`.

Variaveis de ambiente necessarias:

```env
JWT_SECRET=uma-chave-com-pelo-menos-32-carateres
PORT=3000
```

Consulta `.env.example` para a configuracao completa.

## Estrutura

```text
abolamaya/
|-- public/                 # Tudo o que pode ser servido ao browser
|   |-- css/
|   |-- data/squads/
|   |-- img/
|   |-- js/
|   `-- *.html
|-- server/                 # Aplicacao Express e logica de negocio
|   |-- middleware/
|   |-- routes/
|   |-- scraper/
|   |-- db.js
|   |-- index.js
|   `-- paths.js
|-- scripts/                # Ferramentas administrativas e de manutencao
|-- data/                   # Dados internos, nao expostos pelo servidor
|-- docs/                   # Documentacao detalhada e SQL de referencia
|-- package.json
`-- Dockerfile
```

`server/paths.js` centraliza os caminhos de filesystem. O Express serve apenas
`public/`, evitando expor codigo, configuracao ou dados internos.

O modulo de previsoes com pontos fica desligado por defeito. Quando ativado, cada
aposta usa um ponto do total real do utilizador. O impacto liquido aparece como
`Pts Comunidade` e entra na classificacao atraves de `point_transactions`.

## Verificacao

```bash
npm test
```

O teste valida:

- sintaxe dos scripts inline e referencias de assets em todas as paginas;
- arranque do servidor com uma base de dados temporaria;
- paginas, assets, API e redirects principais;
- bloqueio de acesso HTTP a `.env`, `package.json` e codigo do servidor.

## Comandos uteis

```bash
npm run dev
npm run make-admin -- username
npm run optimize-squads
npm run export:player-stats
npm run import:player-stats-json
```

## Railway

O deploy continua a usar `npm start`. Em producao, define:

```env
DB_PATH=/data/abolamaya.db
AVATARS_DIR=/data/avatars
SKIP_STARTUP_SCRAPE=true
BASE_URL=https://o-teu-dominio
```

Mais detalhes em [`docs/OVERVIEW.md`](docs/OVERVIEW.md).
