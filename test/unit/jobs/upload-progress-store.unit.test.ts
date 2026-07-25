import config from '@/config';
import { completeJob, createJob, failJob, getJob, setProgress, startJob } from '@/jobs/upload-progress-store';

describe('upload-progress-store', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a job in queued status with progress 0', () => {
    createJob('job1', 'me');
    expect(getJob('job1')).toEqual({ status: 'queued', progress: 0, chatId: 'me' });
  });

  it('startJob transitions queued to uploading', () => {
    createJob('job2', 'me');
    startJob('job2');
    expect(getJob('job2')).toMatchObject({ status: 'uploading' });
  });

  it('setProgress updates the progress fraction', () => {
    createJob('job3', 'me');
    startJob('job3');
    setProgress('job3', 0.5);
    expect(getJob('job3')).toMatchObject({ status: 'uploading', progress: 0.5 });
  });

  it('completeJob sets status/progress/result', () => {
    createJob('job4', 'me');
    const result = { message_id: 1, file_name: 'a.mp4', size: 10, mime_type: 'video/mp4', date: 1, url: 'http://x' };
    completeJob('job4', result);
    expect(getJob('job4')).toEqual({ status: 'completed', progress: 1, chatId: 'me', result });
  });

  it('failJob sets status/error', () => {
    createJob('job5', 'me');
    failJob('job5', 'boom');
    expect(getJob('job5')).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('getJob returns undefined for an unknown job id', () => {
    expect(getJob('unknown')).toBeUndefined();
  });

  it('operations on an unknown job id are no-ops', () => {
    expect(() => startJob('unknown')).not.toThrow();
    expect(() => setProgress('unknown', 0.5)).not.toThrow();
    expect(() => completeJob('unknown', undefined)).not.toThrow();
    expect(() => failJob('unknown', 'boom')).not.toThrow();
  });

  it('removes a completed job after uploadProgressTtlMs', () => {
    createJob('job6', 'me');
    completeJob('job6', undefined);
    expect(getJob('job6')).toBeDefined();

    jest.advanceTimersByTime(config.uploadProgressTtlMs);
    expect(getJob('job6')).toBeUndefined();
  });

  it('removes a failed job after uploadProgressTtlMs', () => {
    createJob('job7', 'me');
    failJob('job7', 'boom');
    expect(getJob('job7')).toBeDefined();

    jest.advanceTimersByTime(config.uploadProgressTtlMs);
    expect(getJob('job7')).toBeUndefined();
  });
});
