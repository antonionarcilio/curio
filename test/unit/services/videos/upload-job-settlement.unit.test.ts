const mockDeleteVideoMessage = jest.fn();
const mockCompleteJob = jest.fn();
const mockFinalizeCancelledJob = jest.fn();
const mockIsCancelRequested = jest.fn();

jest.mock('@/telegram-client', () => ({ deleteVideoMessage: mockDeleteVideoMessage }));
jest.mock('@/services/upload-progress-store', () => ({
  completeJob: mockCompleteJob,
  finalizeCancelledJob: mockFinalizeCancelledJob,
  isCancelRequested: mockIsCancelRequested,
}));

import { settleUploadJob } from '@/services/videos/upload-job-settlement';

const uploadedVideo = {
  message_id: 42,
  file_name: 'video.mp4',
  size: 11,
  mime_type: 'video/mp4',
  date: 1700000000,
};

describe('settleUploadJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('completes the job with the signed url when no cancel was requested', async () => {
    mockIsCancelRequested.mockReturnValue(false);

    await settleUploadJob('job1', 'me', 'http://localhost', uploadedVideo);

    expect(mockCompleteJob).toHaveBeenCalledWith('job1', {
      ...uploadedVideo,
      url: expect.stringMatching(/^http:\/\/localhost\/api\/v1\/video\/stream\/me\/42/),
    });
    expect(mockDeleteVideoMessage).not.toHaveBeenCalled();
    expect(mockFinalizeCancelledJob).not.toHaveBeenCalled();
  });

  it('deletes the video and finalizes the job as cancelled when a cancel was requested', async () => {
    mockIsCancelRequested.mockReturnValue(true);
    mockDeleteVideoMessage.mockResolvedValue(undefined);

    await settleUploadJob('job2', 'me', 'http://localhost', uploadedVideo);

    expect(mockDeleteVideoMessage).toHaveBeenCalledWith('me', 42);
    expect(mockFinalizeCancelledJob).toHaveBeenCalledWith('job2');
    expect(mockCompleteJob).not.toHaveBeenCalled();
  });
});
