module.exports = {
  JWT_SECRET: process.env.JWT_SECRET || 'abolamaya-secret-muda-em-producao-usa-string-longa',
  PORT: process.env.PORT || 3000,
  PREDICTION_DEADLINE: new Date('2026-06-11T18:00:00Z'), // 1h before first match (Mexico-SA 19:00 UTC)
};
