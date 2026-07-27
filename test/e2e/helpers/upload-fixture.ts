import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { app, authed } from './http-client';

type UploadJobResponse = {
  status: 'queued' | 'uploading' | 'completed' | 'error';
  chat_id?: string;
  message_id?: number;
  file_name?: string;
  mime_type?: string;
  size?: number;
  url?: string;
  error?: string;
};

// Upload é assíncrono (POST responde 202 com job_id na hora, o envio pro
// Telegram roda em background) — todo arquivo e2e que sobe um fixture próprio
// precisa fazer polling até o job sair de 'queued'/'uploading'.
async function pollUploadJobUntilSettled(jobId: string): Promise<UploadJobResponse> {
  for (;;) {
    const res = await authed(request(app).get(`/api/v1/video/upload/progress/${jobId}`));
    const body = res.body as UploadJobResponse;
    if (body.status === 'completed' || body.status === 'error') return body;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// Sobe um vídeo real via rota HTTP (nunca chamando telegram-client direto) e
// aguarda o job assentar — usado por cada arquivo e2e independente pra criar
// seu próprio fixture, sem depender de nenhum outro arquivo ter rodado antes.
async function uploadTestFixture(
  chatId: string,
  filePath: string,
  opts: { description?: string; thumbnail?: Buffer } = {},
): Promise<UploadJobResponse> {
  let req = authed(request(app).post(`/api/v1/video/upload/${chatId}`)).attach('file', fs.readFileSync(filePath), {
    filename: path.basename(filePath),
    contentType: 'video/mp4',
  });
  if (opts.description) req = req.field('description', opts.description);
  if (opts.thumbnail) {
    req = req.attach('thumbnail', opts.thumbnail, { filename: 'thumb.jpg', contentType: 'image/jpeg' });
  }
  const res = await req;
  return pollUploadJobUntilSettled(res.body.job_id as string);
}

export { pollUploadJobUntilSettled, uploadTestFixture };
export type { UploadJobResponse };
