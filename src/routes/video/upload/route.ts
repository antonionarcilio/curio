import config from '@/config';
import { SAFE_MIME_TYPE } from '@/http/video-response';
import { completeJob, createJob, failJob, setProgress, startJob } from '@/jobs/upload-progress-store';
import { createSignedUrl } from '@/signed-url';
import { MAX_UPLOAD_SIZE_BYTES, uploadVideo } from '@/telegram-client';
import { randomUUID } from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import pLimit from 'p-limit';
import { z } from 'zod';

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_SIZE_BYTES } });
const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 },
]);

// Limita quantos uploads reais (tg.uploadFile/tg.sendFile) rodam ao mesmo
// tempo contra a mesma conta Telegram — mesmo risco de FLOOD_WAIT que motiva
// TELEGRAM_FETCH_CONCURRENCY nas rotas de leitura. Requests além do limite
// ficam retidas aqui (job em 'queued') até uma vaga abrir.
const uploadQueue = pLimit(config.uploadConcurrencyLimit);

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
  const { description } = parsedBody.data;
  const thumbnail = files?.thumbnail?.[0];
  const base = `${req.protocol}://${req.get('host')}`;

  const jobId = randomUUID();
  createJob(jobId, chatId);
  res.status(202).json({ job_id: jobId, status: 'queued' });

  uploadQueue(() => {
    startJob(jobId);
    return uploadVideo(chatId, {
      buffer: file.buffer,
      originalFileName: file.originalname,
      description,
      thumbnailBuffer: thumbnail?.buffer,
      onProgress: (progress) => setProgress(jobId, progress),
    });
  })
    .then((video) => completeJob(jobId, { ...video, url: createSignedUrl(base, chatId, video.message_id) }))
    .catch((err) => failJob(jobId, (err as Error).message));
});

export = router;
