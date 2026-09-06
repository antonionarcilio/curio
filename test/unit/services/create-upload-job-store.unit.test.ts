import { createUploadJobStore } from '@/services/create-upload-job-store';

describe('createUploadJobStore', () => {
  it('creates a job in queued status with progress 0', () => {
    const store = createUploadJobStore<{ url: string }>();
    store.createJob('job1', 'me');
    expect(store.getJob('job1')).toEqual({ status: 'queued', progress: 0, chatId: 'me' });
  });

  it('two independent instances do not share state (same job id in both)', () => {
    const storeA = createUploadJobStore<{ url: string }>();
    const storeB = createUploadJobStore<{ url: string }>();

    storeA.createJob('shared-id', 'chatA');
    storeB.createJob('shared-id', 'chatB');
    storeA.pauseJob('shared-id');

    expect(storeA.getJob('shared-id')).toMatchObject({ status: 'paused', chatId: 'chatA' });
    expect(storeB.getJob('shared-id')).toMatchObject({ status: 'queued', chatId: 'chatB' });
  });

  it('getJobIdsByStatus only reflects jobs created on that instance', () => {
    const storeA = createUploadJobStore<{ url: string }>();
    const storeB = createUploadJobStore<{ url: string }>();

    storeA.createJob('a1', 'chatA');
    storeB.createJob('b1', 'chatB');
    storeB.createJob('b2', 'chatB');

    expect(storeA.getJobIdsByStatus('queued')).toEqual(['a1']);
    expect(storeB.getJobIdsByStatus('queued')).toEqual(['b1', 'b2']);
  });
});
