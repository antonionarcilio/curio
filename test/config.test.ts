// Prevents the real `.env` file from repopulating env vars this suite
// deliberately deletes to exercise config.ts's fallback/throw branches.
jest.mock('dotenv/config', () => ({}));

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  it('throws with the offending env var name when a required var is missing', () => {
    jest.resetModules();
    delete process.env.TELEGRAM_API_ID;
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
      require('../src/config');
    }).toThrow('Missing required env var: TELEGRAM_API_ID');
  });

  it('falls back port to 8787 when PORT is unset', () => {
    jest.resetModules();
    delete process.env.PORT;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('../src/config') as typeof import('../src/config');
    expect(config.port).toBe(8787);
  });

  it('falls back accessToken to "" when ACCESS_TOKEN is unset', () => {
    jest.resetModules();
    delete process.env.ACCESS_TOKEN;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('../src/config') as typeof import('../src/config');
    expect(config.accessToken).toBe('');
  });

  it('falls back nodeEnv to "" (strict/production) when NODE_ENV is unset', () => {
    jest.resetModules();
    delete process.env.NODE_ENV;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('../src/config') as typeof import('../src/config');
    expect(config.nodeEnv).toBe('');
    expect(config.isDev).toBe(false);
  });
});
