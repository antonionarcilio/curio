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
      require('@/config');
    }).toThrow(/TELEGRAM_API_ID/);
  });

  it('throws when TELEGRAM_API_ID is not numeric', () => {
    jest.resetModules();
    process.env.TELEGRAM_API_ID = 'not-a-number';
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
      require('@/config');
    }).toThrow(/TELEGRAM_API_ID/);
  });

  it('throws when ACCESS_TOKEN is missing', () => {
    jest.resetModules();
    delete process.env.ACCESS_TOKEN;
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
      require('@/config');
    }).toThrow(/ACCESS_TOKEN/);
  });

  it('throws when a numeric env var is not a valid number', () => {
    jest.resetModules();
    process.env.PORT = 'not-a-number';
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
      require('@/config');
    }).toThrow(/PORT/);
  });

  it('falls back port to 8787 when PORT is unset', () => {
    jest.resetModules();
    delete process.env.PORT;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('@/config') as typeof import('@/config');
    expect(config.port).toBe(8787);
  });

  it('falls back nodeEnv to "" (strict/production) when NODE_ENV is unset', () => {
    jest.resetModules();
    delete process.env.NODE_ENV;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('@/config') as typeof import('@/config');
    expect(config.nodeEnv).toBe('');
    expect(config.isDev).toBe(false);
  });

  it('falls back uploadProgressTtlMs to 300000 (5 min) when UPLOAD_PROGRESS_TTL_MINUTES is unset', () => {
    jest.resetModules();
    delete process.env.UPLOAD_PROGRESS_TTL_MINUTES;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('@/config') as typeof import('@/config');
    expect(config.uploadProgressTtlMs).toBe(300_000);
  });

  it('reads uploadProgressTtlMs from UPLOAD_PROGRESS_TTL_MINUTES, converted to ms', () => {
    jest.resetModules();
    process.env.UPLOAD_PROGRESS_TTL_MINUTES = '10';
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must re-require after jest.resetModules() to pick up the mutated env
    const config = require('@/config') as typeof import('@/config');
    expect(config.uploadProgressTtlMs).toBe(600_000);
  });
});
