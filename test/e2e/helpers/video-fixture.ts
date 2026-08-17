import { deleteVideoMessage } from '@/telegram-client';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { app, authed } from './http-client';

// Vídeo real de ~177MB/4K/60fps — bem maior que um fixture sintético, então
// exercita o streaming em chunks (CHUNK_SIZE de 512KB) de forma realista ao
// longo de muitas iterações, não só num punhado de bytes.
const TEST_VIDEO_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  '_assets',
  'sample',
  '15158346_3840_2160_60fps.mp4',
);
// Vídeo real menor (~18MB) usado pelos testes de fila de upload
// (cancel/pause/resume) — esses testes precisam de vários uploads reais
// simultâneos pra exercitar concorrência, então usam um arquivo bem menor
// que TEST_VIDEO_PATH em vez do de 177MB.
const TEST_QUEUE_VIDEO_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  '_assets',
  'sample',
  'file_example_MP4_1920_18MG.mp4',
);
const TEST_THUMBNAIL_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  '_assets',
  'sample',
  'file_example_JPG_1MB.jpg',
);
// Nome usado por padrão nos uploads dos fixtures; a rota também aceita o campo
// multipart `filename` para substituir o nome original do arquivo.
const TEST_FILE_NAME = path.basename(TEST_VIDEO_PATH);
// Nome esperado quando o fixture é o vídeo pequeno (TEST_QUEUE_VIDEO_PATH) —
// usado pelos arquivos que não precisam do vídeo de 177MB.
const TEST_QUEUE_FILE_NAME = path.basename(TEST_QUEUE_VIDEO_PATH);
const ORIGINAL_DESCRIPTION = 'legenda original (e2e)';
const EDITED_DESCRIPTION = 'legenda editada (e2e)';

// Canal configurável via env var (ver .env.sample) — sem fallback, pelo mesmo
// motivo de TELEGRAM_SESSION/ACCESS_TOKEN/etc. em src/config.ts: sem um canal
// real e2e não roda de qualquer forma, então um valor default aqui só serviria
// pra expor publicamente qual canal o mantenedor usa pra teste. Precisa do
// prefixo "-100": um ID positivo puro é interpretado pelo TeleProto como PeerUser
// (usuário), não PeerChannel, e a resolução de entidade falha.
const SMOKE_TEST_CHANNEL_ID = process.env.SMOKE_TEST_CHANNEL_ID;
if (!SMOKE_TEST_CHANNEL_ID) {
  throw new Error(
    'SMOKE_TEST_CHANNEL_ID é obrigatório para test:e2e (ver .env.sample) — esperado um ID de canal Telegram com prefixo "-100", ex.: -1001234567890',
  );
}

type E2eTarget = { label: string; chatId: string; isChannel: boolean };

const TARGETS: E2eTarget[] = [
  { label: 'Saved Messages ("me")', chatId: 'me', isChannel: false },
  { label: `canal de teste (${SMOKE_TEST_CHANNEL_ID})`, chatId: SMOKE_TEST_CHANNEL_ID, isChannel: true },
];

// O Telegram exige uma thumb pequena pra sendFile (tipicamente ≤320x320, poucos
// KB) e rejeita valores fora disso — o JPG original é 3800x2534/~1MB, por isso
// é redimensionado aqui antes de anexar no upload.
async function buildSmallThumbnailBuffer(): Promise<Buffer> {
  return sharp(TEST_THUMBNAIL_PATH).resize(320, 320, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
}

// Rede de segurança pro afterAll de delete-video.e2e.test.ts: garante que o
// fixture é removido mesmo se a própria asserção HTTP de delete falhar —
// chama a função direto, não a rota, precisamente para não depender da rota
// que pode ser a que está quebrada.
async function removeFixture(chatId: string, messageId: number): Promise<void> {
  await deleteVideoMessage(chatId, messageId);
}

// Limpeza pra qualquer outro arquivo e2e que não testa a rota de delete em
// si (ex.: os testes de fila de upload) — ao contrário de removeFixture,
// aqui não existe risco de circularidade, então a limpeza passa pela rota
// real como qualquer outra ação do teste.
async function deleteFixtureViaApi(chatId: string, messageId: number): Promise<void> {
  await authed(request(app).delete(`/api/v1/video/delete/${chatId}/${messageId}`));
}

export {
  buildSmallThumbnailBuffer,
  deleteFixtureViaApi,
  EDITED_DESCRIPTION,
  ORIGINAL_DESCRIPTION,
  removeFixture,
  SMOKE_TEST_CHANNEL_ID,
  TARGETS,
  TEST_FILE_NAME,
  TEST_QUEUE_FILE_NAME,
  TEST_QUEUE_VIDEO_PATH,
  TEST_THUMBNAIL_PATH,
  TEST_VIDEO_PATH,
};
export type { E2eTarget };
