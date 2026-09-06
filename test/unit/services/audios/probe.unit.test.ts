const mockExecFile = jest.fn();

jest.mock('child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    callback: (error: Error | null, result?: { stdout: string; stderr: string }) => void,
  ) => mockExecFile(file, args, callback),
}));

import { probeAudioMetadata } from '@/services/audios/probe';

function ffprobeJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    format: { duration: '180.4', tags: { title: 'Song Title', artist: 'The Artist' } },
    streams: [{ codec_type: 'audio' }],
    ...overrides,
  });
}

describe('probeAudioMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses duration/title/performer from ffprobe JSON output', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(null, { stdout: ffprobeJson(), stderr: '' }));

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toEqual({ duration: 180, title: 'Song Title', performer: 'The Artist' });
    expect(mockExecFile).toHaveBeenCalledWith(
      'ffprobe',
      expect.arrayContaining(['/tmp/audio.mp3']),
      expect.any(Function),
    );
  });

  it('reads performer from a "performer" tag when "artist" is absent', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, {
        stdout: JSON.stringify({
          format: { duration: '10', tags: { performer: 'A Performer' } },
          streams: [{ codec_type: 'audio' }],
        }),
        stderr: '',
      }),
    );

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toEqual({ duration: 10, title: null, performer: 'A Performer' });
  });

  it('matches tag keys case-insensitively (e.g. uppercase ID3 tags)', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, {
        stdout: JSON.stringify({
          format: { duration: '10', tags: { TITLE: 'Upper Title', ARTIST: 'Upper Artist' } },
          streams: [{ codec_type: 'audio' }],
        }),
        stderr: '',
      }),
    );

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toEqual({ duration: 10, title: 'Upper Title', performer: 'Upper Artist' });
  });

  it('falls back to the audio stream duration when format.duration is missing', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, {
        stdout: JSON.stringify({
          format: {},
          streams: [{ codec_type: 'audio', duration: '5' }],
        }),
        stderr: '',
      }),
    );

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toEqual({ duration: 5, title: null, performer: null });
  });

  it('returns null when there is no audio stream and no format.duration', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, { stdout: JSON.stringify({ format: {}, streams: [] }), stderr: '' }),
    );

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toBeNull();
  });

  it('returns null when duration cannot be determined', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, { stdout: ffprobeJson({ format: { duration: '0' } }), stderr: '' }),
    );

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toBeNull();
  });

  it('returns null when ffprobe fails/is unavailable', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) => callback(new Error('ffprobe: command not found')));

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toBeNull();
  });

  it('title/performer are independently optional (missing tags object)', async () => {
    mockExecFile.mockImplementation((_file, _args, callback) =>
      callback(null, {
        stdout: JSON.stringify({ format: { duration: '10' }, streams: [{ codec_type: 'audio' }] }),
        stderr: '',
      }),
    );

    const result = await probeAudioMetadata('/tmp/audio.mp3');

    expect(result).toEqual({ duration: 10, title: null, performer: null });
  });
});
