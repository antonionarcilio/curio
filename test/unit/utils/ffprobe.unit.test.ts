const mockExecFile = jest.fn();

jest.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => mockExecFile(file, args, callback),
}));

import { runFfprobeJson } from '@/utils/ffprobe';

describe('runFfprobeJson', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses ffprobe JSON stdout', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, { stdout: JSON.stringify({ format: { duration: '12' }, streams: [] }), stderr: '' }),
    );

    const result = await runFfprobeJson('/tmp/file.mp3');

    expect(result).toEqual({ format: { duration: '12' }, streams: [] });
    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['/tmp/file.mp3']),
      expect.any(Function),
    );
  });

  it('returns null when ffprobe fails/is unavailable', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(new Error('ffprobe: command not found')));

    const result = await runFfprobeJson('/tmp/file.mp3');

    expect(result).toBeNull();
  });

  it('returns null when stdout is not valid JSON', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(null, { stdout: 'not json', stderr: '' }));

    const result = await runFfprobeJson('/tmp/file.mp3');

    expect(result).toBeNull();
  });
});
