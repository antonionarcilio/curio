import { streamTelegramVideo } from '@/services/videos/stream';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/video/stream/:chatId/:messageId', async (req: Request, res: Response) => {
  await streamTelegramVideo(req, res, { disposition: 'inline' });
});

export = router;
