import { deleteVideoMessage } from '@/telegram-client';
import express, { type Request, type Response } from 'express';

const router = express.Router();

router.delete('/video/delete/:chatId/:messageId', async (req: Request, res: Response) => {
  try {
    const { chatId, messageId } = req.params;
    await deleteVideoMessage(chatId, messageId);
    res.json({ deleted: true, chat_id: chatId, message_id: messageId });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

export = router;
