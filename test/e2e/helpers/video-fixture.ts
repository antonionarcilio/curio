import { deleteVideoMessage, uploadVideo } from '@/telegram-client';
import fs from 'fs';
import path from 'path';

const TEST_VIDEO_PATH = path.join(__dirname, '..', '..', '..', 'src', '_assets', 'file_example_MP4_1920_18MG.mp4');
const TEST_FILE_NAME = 'smoke-test-video.mp4';
const ORIGINAL_DESCRIPTION = 'legenda original (smoke test)';
const EDITED_DESCRIPTION = 'legenda editada (smoke test)';

// Canal configurável via env var pra facilitar troca sem editar os testes — o
// valor abaixo é só um fallback de conveniência (ver .env.example). Precisa do
// prefixo "-100": um ID positivo puro é interpretado pelo GramJS como PeerUser
// (usuário), não PeerChannel, e a resolução de entidade falha.
const SMOKE_TEST_CHANNEL_ID = process.env.SMOKE_TEST_CHANNEL_ID || '-1004325653681';

type E2eTarget = { label: string; chatId: string; isChannel: boolean };

const TARGETS: E2eTarget[] = [
  { label: 'Saved Messages ("me")', chatId: 'me', isChannel: false },
  { label: `canal de teste (${SMOKE_TEST_CHANNEL_ID})`, chatId: SMOKE_TEST_CHANNEL_ID, isChannel: true },
];

async function uploadFixture(chatId: string): Promise<number> {
  const buffer = fs.readFileSync(TEST_VIDEO_PATH);
  const video = await uploadVideo(chatId, {
    buffer,
    originalFileName: path.basename(TEST_VIDEO_PATH),
    fileName: TEST_FILE_NAME,
    description: ORIGINAL_DESCRIPTION,
  });
  return video.message_id;
}

async function removeFixture(chatId: string, messageId: number): Promise<void> {
  await deleteVideoMessage(chatId, messageId);
}

export {
  EDITED_DESCRIPTION,
  ORIGINAL_DESCRIPTION,
  removeFixture,
  TARGETS,
  TEST_FILE_NAME,
  TEST_VIDEO_PATH,
  uploadFixture,
};
export type { E2eTarget };
