import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  cleanupOrphanedUploadFiles,
  cleanupUploadFiles,
  ensureUploadTempDir,
  uploadTempDir,
  uploadTempFileName,
} from '@/services/videos/upload-temp-files';

const currentTempDir = uploadTempDir();
const legacyTempDir = path.join(os.tmpdir(), 'tg-uploader-api');

describe('upload temporary files', () => {
  afterEach(async () => {
    await Promise.all([
      fs.rm(currentTempDir, { recursive: true, force: true }),
      fs.rm(legacyTempDir, { recursive: true, force: true }),
    ]);
  });

  it('creates the api-tg-cdn directory with owner-only permissions', async () => {
    expect(ensureUploadTempDir()).toBe(currentTempDir);
    const stat = await fs.stat(currentTempDir);

    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it('generates unique temporary file names and removes uploaded files', async () => {
    const first = uploadTempFileName();
    const second = uploadTempFileName();
    expect(first).not.toBe(second);

    await fs.mkdir(currentTempDir, { recursive: true });
    const filePath = path.join(currentTempDir, first);
    await fs.writeFile(filePath, 'upload');
    await cleanupUploadFiles([filePath, path.join(currentTempDir, 'missing')]);

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('cleans the new and legacy directories on startup', async () => {
    await fs.mkdir(currentTempDir, { recursive: true });
    await fs.mkdir(legacyTempDir, { recursive: true });
    await fs.writeFile(path.join(currentTempDir, 'orphan'), 'new');
    await fs.writeFile(path.join(legacyTempDir, 'orphan'), 'legacy');

    await cleanupOrphanedUploadFiles();

    await expect(fs.access(path.join(legacyTempDir, 'orphan'))).rejects.toThrow();
    await expect(fs.access(path.join(currentTempDir, 'orphan'))).rejects.toThrow();
    expect((await fs.stat(currentTempDir)).isDirectory()).toBe(true);
  });
});
