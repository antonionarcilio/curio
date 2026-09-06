import { streamTelegramAudio } from '@/services/audios/stream';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/audio/stream/:chatId/:messageId', async (req: Request, res: Response) => {
  await streamTelegramAudio(req, res, { disposition: 'inline' });
});

export = router;
