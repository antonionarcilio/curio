import { createSignedUrl } from '@/signed-url';
import { uploadVideo } from '@/telegram-client';
import express, { type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { SAFE_MIME_TYPE } from './http-utils';

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });
const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

const uploadBodySchema = z.object({
  file_name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).max(1024).optional(),
});

router.post('/video/:chatId', uploadFields, async (req: Request, res: Response) => {
  const files = req.files as { file?: Express.Multer.File[]; thumbnail?: Express.Multer.File[] } | undefined;
  const file = files?.file?.[0];
  if (!file) {
    res.status(400).json({ error: 'Campo "file" é obrigatório' });
    return;
  }
  if (!SAFE_MIME_TYPE.test(file.mimetype)) {
    res.status(400).json({ error: `Tipo de arquivo não suportado: ${file.mimetype}` });
    return;
  }

  const parsedBody = uploadBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.message });
    return;
  }

  try {
    const { chatId } = req.params;
    const { file_name, description } = parsedBody.data;
    const thumbnail = files?.thumbnail?.[0];
    const base = `${req.protocol}://${req.get('host')}`;

    const video = await uploadVideo(chatId, {
      buffer: file.buffer,
      originalFileName: file.originalname,
      fileName: file_name,
      description,
      thumbnailBuffer: thumbnail?.buffer,
    });

    res.json({ chat_id: chatId, ...video, url: createSignedUrl(base, chatId, video.message_id) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
