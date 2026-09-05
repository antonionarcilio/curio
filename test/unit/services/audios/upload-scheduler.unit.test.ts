const mockGetJob = jest.fn();
const mockStartJob = jest.fn();

jest.mock('@/services/audios/upload-progress-store', () => ({
  audioUploadJobStore: {
    getJob: mockGetJob,
    startJob: mockStartJob,
  },
}));

import { enqueueUpload, notifyQueueChanged, removeFromQueue } from '@/services/audios/upload-scheduler';

type JobStatus = 'queued' | 'paused' | 'uploading' | 'cancelled';

const uploadedAudio = { message_id: 1, file_name: 'a.mp3', size: 1, mime_type: 'audio/mpeg', date: 1 };

describe('audios/upload-scheduler', () => {
  const statuses = new Map<string, JobStatus>();

  beforeEach(() => {
    jest.clearAllMocks();
    statuses.clear();
    mockGetJob.mockImplementation((jobId: string) => {
      const status = statuses.get(jobId);
      return status ? { status } : undefined;
    });
  });

  it('runs the task immediately when a slot is free', async () => {
    statuses.set('job1', 'queued');
    const run = jest.fn().mockResolvedValue(uploadedAudio);

    const result = await enqueueUpload('job1', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(mockStartJob).toHaveBeenCalledWith('job1');
    expect(result).toEqual(uploadedAudio);
  });

  it('keeps a second task pending until the first settles (UPLOAD_CONCURRENCY_LIMIT default 1)', async () => {
    statuses.set('job2', 'queued');
    statuses.set('job3', 'queued');
    let resolveFirst!: (value: typeof uploadedAudio) => void;
    const firstRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveFirst = resolve)));
    const secondRun = jest.fn().mockResolvedValue(uploadedAudio);

    enqueueUpload('job2', firstRun);
    const secondPromise = enqueueUpload('job3', secondRun);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondRun).not.toHaveBeenCalled();

    resolveFirst(uploadedAudio);
    await secondPromise;
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('discards a cancelled pending job without ever running it', async () => {
    statuses.set('job4', 'queued');
    let resolveActive!: (value: typeof uploadedAudio) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job4', activeRun);

    statuses.set('job5', 'cancelled');
    const cancelledRun = jest.fn().mockResolvedValue(uploadedAudio);
    const cancelledPromise = enqueueUpload('job5', cancelledRun);

    resolveActive(uploadedAudio);
    const result = await cancelledPromise;

    expect(cancelledRun).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('notifyQueueChanged lets a resumed job run without a new enqueue event', async () => {
    statuses.set('job6', 'queued');
    let resolveActive!: (value: typeof uploadedAudio) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job6', activeRun);

    statuses.set('job7', 'paused');
    const pausedRun = jest.fn().mockResolvedValue(uploadedAudio);
    const pausedPromise = enqueueUpload('job7', pausedRun);

    resolveActive(uploadedAudio);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pausedRun).not.toHaveBeenCalled();

    statuses.set('job7', 'queued');
    notifyQueueChanged();
    await pausedPromise;

    expect(pausedRun).toHaveBeenCalledTimes(1);
  });

  it('removeFromQueue drops a pending entry immediately, resolving it as undefined', async () => {
    statuses.set('job8', 'queued');
    let resolveActive!: (value: typeof uploadedAudio) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job8', activeRun);

    statuses.set('job9', 'queued');
    const removedRun = jest.fn().mockResolvedValue(uploadedAudio);
    const removedPromise = enqueueUpload('job9', removedRun);

    removeFromQueue('job9');
    resolveActive(uploadedAudio);
    const result = await removedPromise;

    expect(removedRun).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });
});
