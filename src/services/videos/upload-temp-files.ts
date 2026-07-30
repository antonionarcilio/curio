import crypto from 'crypto';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const UPLOAD_TEMP_DIR = path.join(os.tmpdir(), 'tg-uploader-api');

function uploadTempDir(): string {
  return UPLOAD_TEMP_DIR;
}

function ensureUploadTempDir(): string {
  fsSync.mkdirSync(UPLOAD_TEMP_DIR, { recursive: true, mode: 0o700 });
  return UPLOAD_TEMP_DIR;
}

function uploadTempFileName(): string {
  return crypto.randomUUID();
}

async function cleanupUploadFiles(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((filePath) => fs.rm(filePath, { force: true }).catch(() => undefined)));
}

// Arquivos deixados por uma queda do processo não pertencem a nenhum job
// recuperável: jobs de upload são somente em memória. Limpa-os antes de
// aceitar novas requisições no próximo boot.
async function cleanupOrphanedUploadFiles(): Promise<void> {
  await fs.rm(UPLOAD_TEMP_DIR, { recursive: true, force: true });
  ensureUploadTempDir();
}

export { cleanupOrphanedUploadFiles, cleanupUploadFiles, ensureUploadTempDir, uploadTempDir, uploadTempFileName };
