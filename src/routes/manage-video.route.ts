import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { deleteVideoMessage, editVideoCaption } from '../telegram-client';

const router = express.Router();

const editVideoBodySchema = z.object({
  description: z.string().trim().min(1).max(1024),
});

router.patch('/video/:chatId/:messageId', async (req: Request, res: Response) => {
  const parsedBody = editVideoBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  try {
    const { chatId, messageId } = req.params;
    await editVideoCaption(chatId, messageId, parsedBody.data.description);
    res.json({ edited: true, chat_id: chatId, message_id: messageId });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

router.delete('/video/:chatId/:messageId', async (req: Request, res: Response) => {
  try {
    const { chatId, messageId } = req.params;
    await deleteVideoMessage(chatId, messageId);
    res.json({ deleted: true, chat_id: chatId, message_id: messageId });
  } catch (err) {
    res.status(404).json({ error: (err as Error).message });
  }
});

export = router;
