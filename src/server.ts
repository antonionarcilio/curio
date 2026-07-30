import crypto from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import config from './config';
import router from './router';
import { cleanupOrphanedUploadFiles } from './services/videos/upload-temp-files';
import { verifySignedUrl } from './signed-url';
import { ensureConnected } from './telegram-client';

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization || '';
  const match = /^Bearer (.+)$/.exec(header);
  return match ? match[1] : '';
}

// A rota de streaming precisa ser abrível direto por URL (VLC, <video src>),
// que não enviam headers customizados numa navegação simples. Em vez de
// aceitar o token mestre na query string (o que o exporia em qualquer lugar
// que a URL vaze — histórico, logs, etc.), ela aceita uma URL assinada e com
// expiração (?exp=&sig=), escopada só àquele chatId/messageId. A rota de
// download aceita o mesmo par assinado porque também precisa funcionar como
// URL direta. As demais rotas exigem o header com o token mestre.
const SIGNED_VIDEO_PATH = /^\/api\/v1\/video\/(?:stream|dl)\/([^/]+)\/([^/]+)$/;

function verifySignedStream(req: Request): boolean {
  const match = SIGNED_VIDEO_PATH.exec(req.path);
  if (!match) return false;

  const [, chatId, messageId] = match;
  const { exp, sig } = req.query;
  if (!exp || !sig) return false;

  return verifySignedUrl(chatId, messageId, exp as string, sig as string);
}

function requireToken(req: Request, res: Response, next: NextFunction): void {
  // Em desenvolvimento (NODE_ENV=development explícito), injeta o token
  // automaticamente quando o header não é enviado, pra evitar ter que passar
  // `Authorization` manualmente a cada request local. Qualquer outro valor de
  // NODE_ENV (incluindo ausente) cai no modo estrito — nunca autentica sozinho.
  if (config.isDev && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${config.accessToken}`;
  }

  const token = extractBearerToken(req);
  if (config.accessToken && timingSafeEqualStrings(token, config.accessToken)) {
    next();
    return;
  }

  if (verifySignedStream(req)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Token inválido ou ausente' });
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(requireToken);
  app.use('/api/v1', router);
  return app;
}

async function startServer() {
  await cleanupOrphanedUploadFiles();
  await ensureConnected();

  const app = buildApp();

  return app.listen(config.port, () => {
    console.log(`tg-uploader-api rodando em http://localhost:${config.port}`);
    if (config.isDev) {
      console.log('Modo dev: Authorization é preenchido automaticamente se omitido.');
    }
    console.log(
      `Exemplo: curl -H "Authorization: Bearer <ACCESS_TOKEN>" http://localhost:${config.port}/api/v1/video/stream/<chatId>/<messageId>`,
    );
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { buildApp, extractBearerToken, requireToken, startServer, timingSafeEqualStrings, verifySignedStream };
