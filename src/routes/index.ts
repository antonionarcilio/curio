import express, { type Request, type Response } from 'express';
import channelVideosRouter from './channel-videos.route';
import listChannelsRouter from './list-channels.route';
import listChatVideosRouter from './list-chat-videos.route';
import listVideosRouter from './list-videos.route';
import manageVideoRouter from './manage-video.route';
import purgeCacheRouter from './purge-cache.route';
import streamVideoRouter from './stream-video.route';
import uploadVideoRouter from './upload-video.route';

const router = express.Router();

router.use(listVideosRouter);
router.use(listChannelsRouter);
router.use(channelVideosRouter);
router.use(listChatVideosRouter);
router.use(purgeCacheRouter);
router.use(uploadVideoRouter);
router.use(manageVideoRouter);
router.use(streamVideoRouter);

type RouteLayer = {
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
};

// Cada rota vive num sub-router montado (`router.use(...)`), então listar as
// rotas exige descer recursivamente pelos layers montados, não só pelo
// `router.stack` de primeiro nível — senão só apareceria `/routes`.
function collectRoutes(stack: RouteLayer[]): { method: string; path: string }[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const { route } = layer;
      return Object.keys(route.methods)
        .filter((method) => route.methods[method])
        .map((method) => ({ method: method.toUpperCase(), path: route.path }));
    }
    if (layer.handle?.stack) {
      return collectRoutes(layer.handle.stack);
    }
    return [];
  });
}

router.get('/routes', (req: Request, res: Response) => {
  res.json(collectRoutes(router.stack as unknown as RouteLayer[]));
});

export = router;
