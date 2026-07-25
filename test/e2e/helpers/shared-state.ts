import fs from 'fs';
import path from 'path';

// Cada arquivo *.e2e.test.ts roda com um module registry isolado, então não
// dá pra guardar o messageId do upload numa variável de módulo e esperar que
// o próximo arquivo (upload -> update -> leituras -> purge -> delete) veja o
// mesmo valor — precisa persistir em disco entre processos de teste.
const STATE_DIR = path.join(__dirname, '..', '.state');
const STATE_FILE = path.join(STATE_DIR, 'fixtures.json');

type FixtureState = { messageId: number };
type StateFile = Record<string, FixtureState>;

function readStateFile(): StateFile {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as StateFile;
}

function writeStateFile(state: StateFile): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function writeFixtureState(chatId: string, fixture: FixtureState): void {
  const state = readStateFile();
  state[chatId] = fixture;
  writeStateFile(state);
}

export function readFixtureState(chatId: string): FixtureState | undefined {
  return readStateFile()[chatId];
}

export function clearFixtureState(chatId: string): void {
  const state = readStateFile();
  delete state[chatId];
  writeStateFile(state);
}
