/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Sem setupFiles: test/setup-env.ts injeta credenciais FALSAS — carregá-lo aqui
  // faria os testes autenticarem numa conta inexistente. src/config.ts já faz
  // `import 'dotenv/config'`, então o .env real é lido sozinho.
  testMatch: ['**/test/e2e/**/*.e2e.test.ts'],
  // Serial: os testes usam a mesma conta real do Telegram; rodar em paralelo
  // dispara FLOOD_WAIT. Também garante que os arquivos rodem na ordem que o
  // testSequencer abaixo define — upload -> update -> leituras -> purge ->
  // delete, uma cadeia que reaproveita um único fixture por alvo.
  maxWorkers: 1,
  testSequencer: '<rootDir>/test/e2e/sequencer.js',
  // client.destroy() (ver test/e2e/*.e2e.test.ts) já resolve o loop de ping
  // infinito do GramJS, mas cada TelegramClient normalmente mantém conexões
  // com mais de um datacenter (principal + o de mídia, usado no upload/download
  // do fixture grande) — cada uma agenda seu próprio timeout interno de
  // confirmação de disconnect, que ainda dispara alguns instantes depois do
  // destroy() já ter resolvido. forceExit garante que o processo encerra
  // assim que os resultados dos testes são reportados, em vez de ficar
  // esperando esses timers residuais (bem menores e finitos, ao contrário do
  // loop de ping — mas ainda impedem o Jest de sair sozinho em ~1s).
  forceExit: true,
  // Vídeo de ~177MB/4K: bem mais lento que um fixture sintético pequeno —
  // ~1.2-3.8s/MB medido com um fixture anterior de 17MB, o que pode passar de
  // 10min só no upload pro canal. Folga generosa pro pior caso.
  testTimeout: 1_200_000,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
};
