const mockGetJob = jest.fn();
const mockStartJob = jest.fn();

jest.mock('@/services/upload-progress-store', () => ({
  getJob: mockGetJob,
  startJob: mockStartJob,
}));

import { enqueueUpload, notifyQueueChanged, removeFromQueue } from '@/services/videos/upload-scheduler';

type JobStatus = 'queued' | 'paused' | 'uploading' | 'cancelled';

const uploadedVideo = { message_id: 1, file_name: 'a.mp4', size: 1, mime_type: 'video/mp4', date: 1 };

describe('upload-scheduler', () => {
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
    const run = jest.fn().mockResolvedValue(uploadedVideo);

    const result = await enqueueUpload('job1', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(mockStartJob).toHaveBeenCalledWith('job1');
    expect(result).toEqual(uploadedVideo);
  });

  it('keeps a second task pending until the first settles (UPLOAD_CONCURRENCY_LIMIT default 1)', async () => {
    statuses.set('job2', 'queued');
    statuses.set('job3', 'queued');
    let resolveFirst!: (value: typeof uploadedVideo) => void;
    const firstRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveFirst = resolve)));
    const secondRun = jest.fn().mockResolvedValue(uploadedVideo);

    enqueueUpload('job2', firstRun);
    const secondPromise = enqueueUpload('job3', secondRun);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondRun).not.toHaveBeenCalled();

    resolveFirst(uploadedVideo);
    await secondPromise;
    expect(secondRun).toHaveBeenCalledTimes(1);
  });

  it('skips a paused job and runs the next queued one behind it', async () => {
    statuses.set('job4', 'queued');
    let resolveActive!: (value: typeof uploadedVideo) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job4', activeRun);

    statuses.set('job5', 'paused');
    statuses.set('job6', 'queued');
    const pausedRun = jest.fn().mockResolvedValue(uploadedVideo);
    const behindRun = jest.fn().mockResolvedValue(uploadedVideo);
    enqueueUpload('job5', pausedRun);
    const behindPromise = enqueueUpload('job6', behindRun);

    resolveActive(uploadedVideo);
    await behindPromise;

    expect(pausedRun).not.toHaveBeenCalled();
    expect(behindRun).toHaveBeenCalledTimes(1);
  });

  it('discards a cancelled pending job without ever running it', async () => {
    statuses.set('job7', 'queued');
    let resolveActive!: (value: typeof uploadedVideo) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job7', activeRun);

    statuses.set('job8', 'cancelled');
    const cancelledRun = jest.fn().mockResolvedValue(uploadedVideo);
    const cancelledPromise = enqueueUpload('job8', cancelledRun);

    resolveActive(uploadedVideo);
    const result = await cancelledPromise;

    expect(cancelledRun).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('notifyQueueChanged lets a resumed job run without a new enqueue event', async () => {
    statuses.set('job9', 'queued');
    let resolveActive!: (value: typeof uploadedVideo) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job9', activeRun);

    statuses.set('job10', 'paused');
    const pausedRun = jest.fn().mockResolvedValue(uploadedVideo);
    const pausedPromise = enqueueUpload('job10', pausedRun);

    resolveActive(uploadedVideo);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pausedRun).not.toHaveBeenCalled();

    statuses.set('job10', 'queued');
    notifyQueueChanged();
    await pausedPromise;

    expect(pausedRun).toHaveBeenCalledTimes(1);
  });

  it('removeFromQueue drops a pending entry immediately, resolving it as undefined', async () => {
    statuses.set('job11', 'queued');
    let resolveActive!: (value: typeof uploadedVideo) => void;
    const activeRun = jest.fn().mockImplementation(() => new Promise((resolve) => (resolveActive = resolve)));
    enqueueUpload('job11', activeRun);

    statuses.set('job12', 'queued');
    const removedRun = jest.fn().mockResolvedValue(uploadedVideo);
    const removedPromise = enqueueUpload('job12', removedRun);

    removeFromQueue('job12');
    resolveActive(uploadedVideo);
    const result = await removedPromise;

    expect(removedRun).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('removeFromQueue is a no-op when the job id is not pending', () => {
    expect(() => removeFromQueue('unknown')).not.toThrow();
  });
});
