import { client, ensureConnected, listChannels } from '@/telegram-client';

beforeAll(() => ensureConnected());
afterAll(() => client.disconnect());

describe('listChannels (e2e)', () => {
  it('returns an array of channel entries from the real account', async () => {
    const channels = await listChannels(5);
    expect(Array.isArray(channels)).toBe(true);
  });
});
