import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

export = router;
