import { editMessageCaption } from '@/telegram-client';
import express, { type Request, type Response } from 'express';
import { z } from 'zod';

const router = express.Router();

const editAudioBodySchema = z.object({
  description: z.string().trim().min(1).max(1024),
});

router.patch('/audio/update/:chatId/:messageId', async (req: Request, res: Response) => {
  const parsedBody = editAudioBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  try {
    const { chatId, messageId } = req.params;
    await editMessageCaption(chatId, messageId, parsedBody.data.description);
    res.json({ edited: true, chat_id: chatId, message_id: messageId });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

export = router;
