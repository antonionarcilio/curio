import { streamTelegramVideo } from '@/http/video-stream';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.get('/video/dl/:chatId/:messageId', async (req: Request, res: Response) => {
  await streamTelegramVideo(req, res, { disposition: 'attachment' });
});

export = router;
