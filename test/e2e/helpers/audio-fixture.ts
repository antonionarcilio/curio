import { deleteMessage } from '@/telegram-client';
import path from 'path';
import request from 'supertest';
import { app, authed } from './http-client';
import { TARGETS } from './video-fixture';

// Áudio real curto (~5s, tom senoidal sintético gerado via ffmpeg com tags
// ID3 title/artist) — pequeno o bastante pra não repetir o custo de um
// fixture grande em cada arquivo e2e de áudio, mas suficiente pra exercitar
// upload/stream/download/update/delete de ponta a ponta.
const TEST_AUDIO_PATH = path.join(__dirname, '..', '..', '..', 'src', '_assets', 'sample', 'sample-audio.mp3');
const TEST_AUDIO_FILE_NAME = path.basename(TEST_AUDIO_PATH);
const ORIGINAL_AUDIO_DESCRIPTION = 'legenda original de áudio (e2e)';
const EDITED_AUDIO_DESCRIPTION = 'legenda editada de áudio (e2e)';

// Rede de segurança pro afterAll de delete-audio.e2e.test.ts: garante que o
// fixture é removido mesmo se a própria asserção HTTP de delete falhar —
// chama a função direto, não a rota, precisamente para não depender da rota
// que pode ser a que está quebrada.
async function removeAudioFixture(chatId: string, messageId: number): Promise<void> {
  await deleteMessage(chatId, messageId);
}

// Limpeza pra qualquer outro arquivo e2e que não testa a rota de delete em
// si — ao contrário de removeAudioFixture, aqui não existe risco de
// circularidade, então a limpeza passa pela rota real como qualquer outra
// ação do teste.
async function deleteAudioFixtureViaApi(chatId: string, messageId: number): Promise<void> {
  await authed(request(app).delete(`/api/v1/audio/delete/${chatId}/${messageId}`));
}

export {
  deleteAudioFixtureViaApi,
  EDITED_AUDIO_DESCRIPTION,
  ORIGINAL_AUDIO_DESCRIPTION,
  removeAudioFixture,
  TARGETS,
  TEST_AUDIO_FILE_NAME,
  TEST_AUDIO_PATH,
};
