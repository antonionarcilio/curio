import { createUploadJobStore } from '@/services/create-upload-job-store';
import { createUploadScheduler } from '@/services/create-upload-scheduler';

describe('createUploadScheduler', () => {
  it('runs a task immediately when a slot is free', async () => {
    const store = createUploadJobStore<{ url: string }>();
    const scheduler = createUploadScheduler({ concurrencyLimit: 1, store });
    store.createJob('job1', 'me');

    const run = jest.fn().mockResolvedValue('done');
    const result = await scheduler.enqueueUpload('job1', run);

    expect(run).toHaveBeenCalledTimes(1);
    expect(result).toBe('done');
  });

  it('two independent schedulers do not share a concurrency slot (each has its own limit of 1)', async () => {
    const videoStore = createUploadJobStore<{ url: string }>();
    const audioStore = createUploadJobStore<{ url: string }>();
    const videoScheduler = createUploadScheduler({ concurrencyLimit: 1, store: videoStore });
    const audioScheduler = createUploadScheduler({ concurrencyLimit: 1, store: audioStore });

    videoStore.createJob('video-job', 'me');
    audioStore.createJob('audio-job', 'me');

    let resolveVideo!: (value: string) => void;
    const videoRun = jest.fn().mockImplementation(() => new Promise<string>((resolve) => (resolveVideo = resolve)));
    const audioRun = jest.fn().mockResolvedValue('audio-done');

    // Ocupa o único slot do scheduler de vídeo, deixando o job "em voo".
    const videoPromise = videoScheduler.enqueueUpload('video-job', videoRun);

    // O scheduler de áudio, independente, roda seu próprio job imediatamente
    // mesmo com o de vídeo ainda ocupado — prova que não competem pela mesma
    // vaga de concorrência.
    const audioResult = await audioScheduler.enqueueUpload('audio-job', audioRun);

    expect(audioRun).toHaveBeenCalledTimes(1);
    expect(audioResult).toBe('audio-done');

    resolveVideo('video-done');
    await expect(videoPromise).resolves.toBe('video-done');
  });

  it('keeps a second task pending until the first settles when the limit is 1', async () => {
    const store = createUploadJobStore<{ url: string }>();
    const scheduler = createUploadScheduler({ concurrencyLimit: 1, store });
    store.createJob('job1', 'me');
    store.createJob('job2', 'me');

    let resolveFirst!: (value: string) => void;
    const firstRun = jest.fn().mockImplementation(() => new Promise<string>((resolve) => (resolveFirst = resolve)));
    const secondRun = jest.fn().mockResolvedValue('second');

    scheduler.enqueueUpload('job1', firstRun);
    const secondPromise = scheduler.enqueueUpload('job2', secondRun);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(secondRun).not.toHaveBeenCalled();

    resolveFirst('first');
    await secondPromise;
    expect(secondRun).toHaveBeenCalledTimes(1);
  });
});
