import 'dotenv/config';
import { z } from 'zod';

// Vazio/ausente cai no fallback em vez de quebrar a coerção numérica do
// zod — comum em .env com a chave presente mas sem valor (ex.: "PORT=").
function numberWithDefault(fallback: number) {
  return z.preprocess((value) => (value === undefined || value === '' ? fallback : value), z.coerce.number().finite());
}

const requiredString = (name: string) => z.string().trim().min(1, `${name} é obrigatório`);

const envSchema = z.object({
  TELEGRAM_API_ID: requiredString('TELEGRAM_API_ID').refine((value) => Number.isFinite(Number(value)), {
    message: 'TELEGRAM_API_ID deve ser numérico',
  }),
  TELEGRAM_API_HASH: requiredString('TELEGRAM_API_HASH'),
  ACCESS_TOKEN: requiredString('ACCESS_TOKEN'),
  TELEGRAM_SESSION: z.string().optional().default(''),
  NODE_ENV: z.string().optional().default(''),
  PORT: numberWithDefault(8787),
  CACHE_TTL_MS: numberWithDefault(180_000),
  TELEGRAM_FETCH_CONCURRENCY: numberWithDefault(5),
  // Em minutos (não ms) porque é o que o operador do servidor mais naturalmente
  // pensa ao configurar retenção — convertido pra ms abaixo, único lugar do
  // código que precisa da unidade em ms (setTimeout em upload-progress-store.ts).
  UPLOAD_PROGRESS_TTL_MINUTES: numberWithDefault(5),
  UPLOAD_CONCURRENCY_LIMIT: numberWithDefault(1),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
  throw new Error(`Configuração de ambiente inválida — ${issues}`);
}

const env = parsedEnv.data;
const nodeEnv = env.NODE_ENV;

const config = {
  apiId: Number(env.TELEGRAM_API_ID),
  apiHash: env.TELEGRAM_API_HASH,
  session: env.TELEGRAM_SESSION,
  port: env.PORT,
  accessToken: env.ACCESS_TOKEN,
  nodeEnv,
  // Fail-closed: só é "dev" com NODE_ENV=development explícito. NODE_ENV
  // ausente/qualquer outro valor cai no modo estrito (produção).
  isDev: nodeEnv === 'development',
  cacheTtlMs: env.CACHE_TTL_MS,
  fetchConcurrency: env.TELEGRAM_FETCH_CONCURRENCY,
  uploadProgressTtlMs: env.UPLOAD_PROGRESS_TTL_MINUTES * 60_000,
  uploadConcurrencyLimit: env.UPLOAD_CONCURRENCY_LIMIT,
};

export = config;
