require('dotenv').config();

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('\n❌  JWT_SECRET não está definido (ou tem menos de 32 chars) — define-o no ficheiro .env\n');
  process.exit(1);
}

module.exports = {
  JWT_SECRET,
  PORT:                process.env.PORT || 3000,
  BASE_URL,
  API_FOOTBALL_KEY:    process.env.API_FOOTBALL_KEY || null,

  SMTP: {
    HOST: process.env.SMTP_HOST || null,
    PORT: parseInt(process.env.SMTP_PORT || '587', 10),
    USER: process.env.SMTP_USER || null,
    PASS: process.env.SMTP_PASS || null,
    FROM: process.env.SMTP_FROM || 'A Bola Maya <noreply@abolamaya.com>',
  },

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
