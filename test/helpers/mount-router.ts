import express, { type Router } from 'express';

type MountRouterOptions = { json?: boolean };

function mountRouter(router: Router | Router[], { json }: MountRouterOptions = {}) {
  const app = express();
  if (json) app.use(express.json());
  app.use(...(Array.isArray(router) ? router : [router]));
  return app;
}

export { mountRouter };
