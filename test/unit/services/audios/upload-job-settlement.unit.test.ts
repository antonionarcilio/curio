const mockDeleteMessage = jest.fn();
const mockCompleteJob = jest.fn();
const mockFinalizeCancelledJob = jest.fn();
const mockIsCancelRequested = jest.fn();

jest.mock('@/telegram-client', () => ({ deleteMessage: mockDeleteMessage }));
jest.mock('@/services/audios/upload-progress-store', () => ({
  audioUploadJobStore: {
    completeJob: mockCompleteJob,
    finalizeCancelledJob: mockFinalizeCancelledJob,
    isCancelRequested: mockIsCancelRequested,
  },
}));

import { settleUploadJob } from '@/services/audios/upload-job-settlement';

const uploadedAudio = {
  message_id: 42,
  file_name: 'song.mp3',
  size: 11,
  mime_type: 'audio/mpeg',
  date: 1700000000,
};

describe('settleUploadJob (audio)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes the job with a signed /api/v1/audio/stream/... url when no cancel was requested', async () => {
    mockIsCancelRequested.mockReturnValue(false);

    await settleUploadJob('job1', 'me', 'http://localhost', uploadedAudio);

    expect(mockCompleteJob).toHaveBeenCalledWith('job1', {
      ...uploadedAudio,
      url: expect.stringMatching(/^http:\/\/localhost\/api\/v1\/audio\/stream\/me\/42/),
    });
    expect(mockDeleteMessage).not.toHaveBeenCalled();
    expect(mockFinalizeCancelledJob).not.toHaveBeenCalled();
  });

  it('deletes the audio message and finalizes the job as cancelled when a cancel was requested', async () => {
    mockIsCancelRequested.mockReturnValue(true);
    mockDeleteMessage.mockResolvedValue(undefined);

    await settleUploadJob('job2', 'me', 'http://localhost', uploadedAudio);

    expect(mockDeleteMessage).toHaveBeenCalledWith('me', 42);
    expect(mockFinalizeCancelledJob).toHaveBeenCalledWith('job2');
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });
});
