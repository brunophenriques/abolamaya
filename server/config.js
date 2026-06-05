require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

module.exports = {
  JWT_SECRET:          process.env.JWT_SECRET || 'abolamaya-secret-muda-em-producao-usa-string-longa',
  PORT:                process.env.PORT || 3000,
  PREDICTION_DEADLINE: new Date('2026-06-11T18:00:00Z'),
  API_FOOTBALL_KEY:    process.env.API_FOOTBALL_KEY || null,

  // OAuth — add keys to .env to enable each provider
  OAUTH: {
    GOOGLE_CLIENT_ID:       process.env.GOOGLE_CLIENT_ID     || null,
    GOOGLE_CLIENT_SECRET:   process.env.GOOGLE_CLIENT_SECRET || null,
    GOOGLE_REDIRECT:        `${BASE_URL}/api/auth/google/callback`,

    GITHUB_CLIENT_ID:       process.env.GITHUB_CLIENT_ID     || null,
    GITHUB_CLIENT_SECRET:   process.env.GITHUB_CLIENT_SECRET || null,
    GITHUB_REDIRECT:        `${BASE_URL}/api/auth/github/callback`,

  },
};
