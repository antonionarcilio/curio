/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Sem setupFiles: test/setup-env.ts injeta credenciais FALSAS — carregá-lo aqui
  // faria os testes autenticarem numa conta inexistente. src/config.ts já faz
  // `import 'dotenv/config'`, então o .env real é lido sozinho.
  testMatch: ['**/test/e2e/**/*.e2e.test.ts'],
  // Serial: os testes usam a mesma conta real do Telegram; rodar em paralelo
  // dispara FLOOD_WAIT.
  maxWorkers: 1,
  // Upload de ~17MB: ~20s em "me", ~65s no canal (medido).
  testTimeout: 120_000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
