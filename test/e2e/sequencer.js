const Sequencer = require('@jest/test-sequencer').default;
const path = require('path');

// A suíte e2e encadeia um único fixture por alvo (upload -> update -> leituras
// -> purge -> delete) através de test/e2e/helpers/shared-state.ts — os
// arquivos posteriores dependem do messageId que o upload grava em disco. O
// Jest não garante ordem entre arquivos por padrão, então essa lista fixa a
// sequência real da cadeia. Arquivos fora da lista (ex: um novo *.e2e.test.ts)
// caem no fim, ordenados por nome, em vez de quebrar.
const ORDER = [
  'upload-video.e2e.test.ts',
  'update-video.e2e.test.ts',
  'videos-grouped.e2e.test.ts',
  'list-channels.e2e.test.ts',
  'videos-by-chat.e2e.test.ts',
  'stream-video.e2e.test.ts',
  'download-video.e2e.test.ts',
  'purge-cache.e2e.test.ts',
  'delete-video.e2e.test.ts',
];

function priorityOf(test) {
  const index = ORDER.indexOf(path.basename(test.path));
  return index === -1 ? ORDER.length : index;
}

class ChainedOrderSequencer extends Sequencer {
  sort(tests) {
    return Array.from(tests).sort((a, b) => {
      const diff = priorityOf(a) - priorityOf(b);
      return diff !== 0 ? diff : a.path.localeCompare(b.path);
    });
  }
}

module.exports = ChainedOrderSequencer;
