import express, { type Router } from 'express';

type MountRouterOptions = { json?: boolean };

function mountRouter(router: Router, { json }: MountRouterOptions = {}) {
  const app = express();
  if (json) app.use(express.json());
  app.use(router);
  return app;
}

export { mountRouter };
