import { deleteVideoMessage } from '@/telegram-client';
import path from 'path';
import sharp from 'sharp';

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
// Upload não permite mais renomear o arquivo (query param `filename`
// removida) — o nome final é sempre o nome original do arquivo enviado.
const TEST_FILE_NAME = path.basename(TEST_VIDEO_PATH);
const ORIGINAL_DESCRIPTION = 'legenda original (e2e)';
const EDITED_DESCRIPTION = 'legenda editada (e2e)';

// Canal configurável via env var pra facilitar troca sem editar os testes — o
// valor abaixo é só um fallback de conveniência (ver .env.sample). Precisa do
// prefixo "-100": um ID positivo puro é interpretado pelo GramJS como PeerUser
// (usuário), não PeerChannel, e a resolução de entidade falha.
const SMOKE_TEST_CHANNEL_ID = process.env.SMOKE_TEST_CHANNEL_ID || '-1004325653681';

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

export {
  buildSmallThumbnailBuffer,
  EDITED_DESCRIPTION,
  ORIGINAL_DESCRIPTION,
  removeFixture,
  SMOKE_TEST_CHANNEL_ID,
  TARGETS,
  TEST_FILE_NAME,
  TEST_THUMBNAIL_PATH,
  TEST_VIDEO_PATH,
};
export type { E2eTarget };
