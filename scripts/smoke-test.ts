import bigInt from 'big-integer';
import path from 'path';
import { client, ensureConnected, getVideoMessage, listChannels, listVideos } from '../src/telegram-client';

const TEST_VIDEO_PATH = path.join(__dirname, '..', 'src', '_assets', 'file_example_MP4_1920_18MG.mp4');
const SAVED_MESSAGES = 'me';

let failed = false;

function report(step: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? 'OK' : 'FALHOU'} - ${step}${detail ? ` (${detail})` : ''}`);
  if (!ok) failed = true;
}

async function checkListChannels(): Promise<void> {
  try {
    const channels = await listChannels(5);
    report('listChannels retorna o shape esperado', Array.isArray(channels));
  } catch (err) {
    report('listChannels retorna o shape esperado', false, (err as Error).message);
  }
}

async function checkVideoRoundTrip(messageId: number): Promise<void> {
  const { total } = await listVideos(SAVED_MESSAGES, { limit: 1, offset: 0 });
  report('listVideos enxerga o vídeo enviado', total >= 1);

  const video = await getVideoMessage(SAVED_MESSAGES, messageId);
  report('getVideoMessage resolve metadados do vídeo real', video.mimeType.startsWith('video/'));

  const chunks: Buffer[] = [];
  const iterator = client.iterDownload({
    file: video.message.media!,
    offset: bigInt(0),
    limit: 1024,
    requestSize: 1024,
  });
  for await (const chunk of iterator) {
    chunks.push(chunk as Buffer);
  }
  report('iterDownload lê bytes reais do vídeo enviado', Buffer.concat(chunks).length > 0);
}

async function main(): Promise<void> {
  await ensureConnected();
  await checkListChannels();

  console.log(`Enviando vídeo de teste para "${SAVED_MESSAGES}"...`);
  const sentMessage = await client.sendFile(SAVED_MESSAGES, {
    file: TEST_VIDEO_PATH,
    supportsStreaming: true,
  });
  report('upload do vídeo de teste', Boolean(sentMessage?.id));

  try {
    await checkVideoRoundTrip(sentMessage.id);
  } finally {
    console.log('Removendo vídeo de teste do Saved Messages...');
    await client.deleteMessages(SAVED_MESSAGES, [sentMessage.id], { revoke: true });
    report('limpeza da mensagem de teste', true);
  }

  await client.disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
