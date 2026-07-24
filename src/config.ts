import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV || '';

const config = {
  apiId: Number(required('TELEGRAM_API_ID')),
  apiHash: required('TELEGRAM_API_HASH'),
  session: process.env.TELEGRAM_SESSION || '',
  port: Number(process.env.PORT || 8787),
  accessToken: process.env.ACCESS_TOKEN || '',
  nodeEnv,
  // Fail-closed: só é "dev" com NODE_ENV=development explícito. NODE_ENV
  // ausente/qualquer outro valor cai no modo estrito (produção).
  isDev: nodeEnv === 'development',
};

export = config;
