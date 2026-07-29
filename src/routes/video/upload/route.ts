import { createJob, failJob, setProgress } from '@/services/upload-progress-store';
import { settleUploadJob } from '@/services/videos/upload-job-settlement';
import { enqueueUpload } from '@/services/videos/upload-scheduler';
import { MAX_UPLOAD_SIZE_BYTES, uploadVideo } from '@/telegram-client';
import { SAFE_MIME_TYPE } from '@/utils/http-response';
import { randomUUID } from 'crypto';
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
  filename: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
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

// O upload real pro Telegram pode levar minutos em arquivos grandes — em vez
// de segurar a resposta HTTP até o fim (o que estoura o timeout de clientes
// como o Insomnia), a rota responde 202 com um job_id assim que o arquivo
// termina de chegar aqui, e o envio pro Telegram continua em background.
// Progresso/resultado final ficam disponíveis via
// GET /video/upload/:jobId/progress (src/routes/video/upload/progress/route.ts).
router.post('/video/upload/:chatId', parseUpload, (req: Request, res: Response) => {
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

  const { chatId } = req.params;
  const { description, filename } = parsedBody.data;
  const originalFileName = filename ?? file.originalname;
  const thumbnail = files?.thumbnail?.[0];
  const base = `${req.protocol}://${req.get('host')}`;

  const jobId = randomUUID();
  createJob(jobId, chatId);
  res.status(202).json({ job_id: jobId, status: 'queued' });

  // enqueueUpload (src/services/videos/upload-scheduler.ts) limita quantos
  // uploads reais (tg.uploadFile/tg.sendFile) rodam ao mesmo tempo contra a
  // conta Telegram (UPLOAD_CONCURRENCY_LIMIT) e é o que permite pausar,
  // retomar ou cancelar um job ainda em fila.
  enqueueUpload(jobId, () =>
    uploadVideo(chatId, {
      buffer: file.buffer,
      originalFileName,
      description,
      thumbnailBuffer: thumbnail?.buffer,
      onProgress: (progress) => setProgress(jobId, progress),
    }),
  )
    .then((video) => video && settleUploadJob(jobId, chatId, base, video))
    .catch((err) => failJob(jobId, (err as Error).message));
});

export = router;
