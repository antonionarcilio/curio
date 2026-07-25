const mockExecFile = jest.fn();
const mockWriteFile = jest.fn().mockResolvedValue(undefined);
const mockRm = jest.fn().mockResolvedValue(undefined);

jest.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => mockExecFile(file, args, callback),
}));

jest.mock('fs/promises', () => ({
  writeFile: mockWriteFile,
  rm: mockRm,
}));

import { probeVideoMetadata } from '@/services/videos/probe';

function ffprobeJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: { duration: '12.345' },
    streams: [{ codec_type: 'video', width: 1920, height: 1080 }],
    ...overrides,
  });
}

describe('probeVideoMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses duration/width/height from ffprobe JSON output', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(null, { stdout: ffprobeJson(), stderr: '' }));

    const result = await probeVideoMetadata(Buffer.from('video-bytes'));

    expect(result).toEqual({ duration: 12, width: 1920, height: 1080 });
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('telegram-cdn-upload-probe-'),
      Buffer.from('video-bytes'),
    );
    expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('telegram-cdn-upload-probe-'), { force: true });
  });

  it('falls back to the video stream duration when format.duration is missing', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, {
        stdout: JSON.stringify({
          format: {},
          streams: [{ codec_type: 'video', width: 640, height: 480, duration: '5' }],
        }),
        stderr: '',
      }),
    );

    const result = await probeVideoMetadata(Buffer.from('x'));

    expect(result).toEqual({ duration: 5, width: 640, height: 480 });
  });

  it('returns null when there is no video stream in the output', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, { stdout: JSON.stringify({ format: { duration: '10' }, streams: [] }), stderr: '' }),
    );

    const result = await probeVideoMetadata(Buffer.from('x'));

    expect(result).toBeNull();
  });

  it('returns null when duration/width/height cannot be determined', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, { stdout: ffprobeJson({ format: { duration: '0' } }), stderr: '' }),
    );

    const result = await probeVideoMetadata(Buffer.from('x'));

    expect(result).toBeNull();
  });

  it('returns null and still cleans up the temp file when ffprobe fails/is unavailable', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(new Error('ffprobe: command not found')));

    const result = await probeVideoMetadata(Buffer.from('x'));

    expect(result).toBeNull();
    expect(mockRm).toHaveBeenCalledTimes(1);
  });

  it('returns null when ffprobe stdout is not valid JSON', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(null, { stdout: 'not json', stderr: '' }));

    const result = await probeVideoMetadata(Buffer.from('x'));

    expect(result).toBeNull();
  });
});
