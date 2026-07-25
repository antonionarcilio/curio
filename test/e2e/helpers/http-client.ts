import config from '@/config';
import { buildApp } from '@/server';

const app = buildApp();

// Todas as rotas exigem o header Authorization, exceto a assinatura via
// ?exp&sig testada explicitamente pelas próprias rotas de stream/download.
function authed<T extends { set: (name: string, value: string) => T }>(req: T): T {
  return req.set('Authorization', `Bearer ${config.accessToken}`);
}

export { app, authed };
