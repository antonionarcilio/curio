import { SAFE_MIME_TYPE } from '@/http/video-response';
import { createSignedUrl } from '@/signed-url';
import { MAX_UPLOAD_SIZE_BYTES, uploadVideo } from '@/telegram-client';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } });
const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

const uploadBodySchema = z.object({
  description: z.string().trim().min(1).max(1024).optional(),
});

// multer reporta arquivo grande demais via `next(err)`, não via req.files —
// precisa de um wrapper pra virar um 400 claro em vez do handler de erro
// padrão do Express.
function parseUpload(req: Request, res: Response, next: NextFunction): void {
  uploadFields(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    const message =
      err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
        ? `Arquivo maior que o limite de ${MAX_UPLOAD_SIZE_BYTES} bytes (mesmo teto do Telegram)`
        : (err as Error).message;
    res.status(400).json({ error: message });
  });
}

router.post('/video/upload/:chatId', parseUpload, async (req: Request, res: Response) => {
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
    const { description } = parsedBody.data;
    const thumbnail = files?.thumbnail?.[0];
    const base = `${req.protocol}://${req.get('host')}`;

    const video = await uploadVideo(chatId, {
      buffer: file.buffer,
      originalFileName: file.originalname,
      description,
      thumbnailBuffer: thumbnail?.buffer,
    });

    res.json({ chat_id: chatId, ...video, url: createSignedUrl(base, chatId, video.message_id) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

export = router;
