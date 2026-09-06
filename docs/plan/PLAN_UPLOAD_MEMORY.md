# Plano: upload limitado, file-backed e fila persistente com Redis + Bull

## Resumo

A rota de upload será reorganizada em quatro aprofundamentos coordenados:

1. Um `UploadJobManager` será responsável por admissão, orçamento, estados e
   limpeza.
2. O upload Telegram será sempre file-backed, impedindo que o TeleProto
   transforme vídeos inteiros em `Buffer`.
3. Redis + Bull substituirão a fila e o armazenamento de jobs em memória,
   permitindo persistência, recuperação após reinício e observabilidade da fila.
4. A rota deixará de capturar closures HTTP e passará a enviar apenas
   descritores leves e serializáveis ao módulo de ciclo de vida.

O contrato externo será preservado: `202`, polling, estados atuais e
cancelamento soft.

## Dependências e infraestrutura

- Adicionar `bull` e `ioredis` como dependências explícitas da aplicação.
- Adicionar um serviço Redis ao Docker Compose, com healthcheck, reinício
  automático e volume persistente para os dados da fila.
- Configurar a conexão por `REDIS_URL` e usar um prefixo de chaves próprio da
  aplicação, evitando colisões com outras filas no mesmo Redis.
- Adicionar `REDIS_MAX_MEMORY`, com valor padrão definido para a instalação,
  e configurar o Redis com `maxmemory-policy noeviction`.
- A política de durabilidade escolhida para a fila é `AOF appendfsync everysec`,
  combinada com snapshots `RDB` e backup do volume do Redis.
- Tratar o limite de memória do Redis como proteção independente do limite de
  jobs: quando a memória estiver esgotada, novas gravações de jobs deverão
  falhar sem remover jobs existentes, e a API deverá traduzir a falha para um
  erro de indisponibilidade/capacidade.
- A aplicação deverá falhar fechado para operações de upload quando Redis não
  estiver disponível; não haverá fallback para a fila em memória.
- O worker Bull será iniciado e encerrado junto com o servidor, com fechamento
  ordenado da fila, conexões Redis e cliente Telegram.
- A escolha nesta etapa é Bull clássico, por ser compatível com a decisão
  Redis + Bull e exigir menor migração do scheduler atual. A manutenção futura
  deve considerar BullMQ como possível evolução.

## Mudanças principais

### 1. Admissão e orçamento

- Adicionar `UPLOAD_MAX_TEMP_BYTES`, padrão `10 GiB`.
- Adicionar `UPLOAD_MAX_PENDING_JOBS`, padrão `50`.
- Adicionar `UPLOAD_TEMP_DIR`, apontando para um diretório persistente de
  spool, por exemplo `/var/lib/api-tg-cdn/uploads`, nunca para `/tmp` em
  instalações que precisam sobreviver a reinícios da máquina.
- Reservar capacidade antes de aceitar o upload:
  - usar `Content-Length` para rejeitar cedo quando possível;
  - manter reserva provisória para requests chunked;
  - ajustar a reserva ao tamanho real após o multipart ser recebido.
- Quando não houver capacidade, responder `429` com:
  - `Retry-After: 60`;
  - JSON com `error`, `reason: "capacity"` e capacidade disponível.
- Tratar falhas de escrita no spool, incluindo `ENOSPC`/disco cheio, como
  falhas controladas de capacidade:
  - interromper o recebimento do upload;
  - remover arquivos parciais;
  - liberar a reserva de bytes e a vaga de job;
  - retornar erro sem deixar job órfão ou continuar o processamento em
    background.
- Manter o limite de jobs mesmo com Redis: ele protege o disco temporário, o
  Redis e o tempo de recuperação, embora a fila deixe de ocupar o heap do Node
  proporcionalmente à quantidade de jobs.
- Liberar reservas em todos os caminhos: validação inválida,
  cancelamento antes da execução, erro, conclusão e limpeza após TTL.

### 2. Upload file-backed

- Encapsular a particularidade do TeleProto em um adapter interno de upload.
- Garantir que `CustomFile` use sempre o caminho do arquivo e que a
  configuração interna force leitura por fatias, independentemente de o vídeo
  ter menos que 2 GiB.
- Remover da interface do upload qualquer possibilidade de carregar o vídeo
  inteiro em memória.
- Impor limite específico de thumbnail, com padrão de `1 MiB`.
- Ler a thumbnail em `Buffer` somente após essa validação.
- Preservar o uso de `ffprobe` por caminho de arquivo.
- Manter `videoSize`, nome lógico, descrição, thumbnail e progresso no
  descritor do job.

### 3. Fila Bull e persistência Redis

- Criar um módulo profundo de fila, com Bull e Redis escondidos atrás de uma
  interface pequena usada pelas rotas e pelo worker.
- Usar o UUID já criado pela rota como `jobId` do Bull.
- O payload persistido no Bull deverá conter somente dados serializáveis:
  `chatId`, caminhos do vídeo e thumbnail, tamanhos, nome lógico, descrição,
  limite de upload e timestamps.
- Nunca persistir `Request`, `Response`, closures, callbacks, promises ou
  `Buffer` de vídeo no payload da fila.
- Substituir:
  - `pending: QueuedUpload[]` por jobs waiting no Bull;
  - `Map<string, UploadJob>` por estado persistido no Redis/Bull;
  - `activeCount` local pelo limite de concorrência do worker.
- Usar o progresso do Bull para alimentar o endpoint de polling e manter o
  resultado final, erro, `cancelRequested` e estado do job persistidos.
- Alinhar a retenção de jobs concluídos, falhos e cancelados ao
  `UPLOAD_PROGRESS_TTL_MINUTES`.
- Manter `UPLOAD_CONCURRENCY_LIMIT` como concorrência do worker Bull.
- O limite `UPLOAD_MAX_PENDING_JOBS` continuará sendo aplicado pela aplicação;
  `REDIS_MAX_MEMORY` limitará o armazenamento do Redis separadamente.
- Com `maxmemory-policy noeviction`, Redis não poderá apagar chaves da fila
  para abrir espaço. Ao atingir `REDIS_MAX_MEMORY`, a criação/atualização de
  jobs que aumentaria o uso de memória deverá falhar, enquanto leituras e
  remoções de jobs existentes continuarão possíveis.
- A configuração de produção deverá reservar margem abaixo do limite físico
  do container/host para overhead, fragmentação e buffers de persistência do
  Redis; `REDIS_MAX_MEMORY` não é limite de espaço em disco.
- O worker deverá consultar o estado persistido antes de iniciar o upload,
  permitindo que jobs pausados sejam ignorados sem remover a capacidade de
  retomá-los.
- Implementar `pause`, `resume`, `cancel` e operações em lote como transições
  atômicas do estado persistido. Pausa individual não deve pausar globalmente
  a fila Bull.
- Para jobs queued/paused, o cancelamento deverá remover o job da execução e
  liberar seus recursos imediatamente.
- Para jobs uploading, preservar o cancelamento soft: o envio termina e a
  mensagem criada é removida antes de o job ser marcado como `cancelled`.
- Não habilitar retry automático por padrão (`attempts: 1`), pois repetir uma
  operação Telegram após uma queda pode criar mensagens duplicadas.
- Jobs interrompidos durante um upload deverão ser reconciliados com segurança;
  não devem ser redisparados cegamente sem verificar se uma mensagem Telegram
  já foi criada.

### 4. Arquivos temporários e recuperação

- Usar `UPLOAD_TEMP_DIR` como spool persistente, montado como volume
  compartilhado entre reinícios do serviço e reinícios do container.
- O diretório não deverá ser `/tmp` quando a recuperação após reinício da
  máquina for requisito, pois seu conteúdo pode ser removido no boot.
- Associar os caminhos persistidos ao `jobId` e validar sua existência antes de
  iniciar o worker.
- O worker e a rota deverão tratar arquivo ausente, ilegível, truncado ou
  parcialmente gravado como erro recuperável do job, removendo o que restar e
  liberando a reserva correspondente.
- No boot, reconciliar jobs Redis/Bull e arquivos locais:
  - jobs `queued` e `paused` com arquivos válidos continuam disponíveis;
  - jobs sem arquivos são marcados como `error` ou `cancelled`, conforme o
    ponto do ciclo de vida, e liberam suas reservas;
  - arquivos sem job correspondente são removidos após a política de cleanup.
- Jobs concluídos, falhos e cancelados devem limpar os arquivos temporários
  somente depois de o estado final ter sido persistido.

### 5. Falhas, recuperação e consistência

- Se o cliente desconectar durante o recebimento do multipart, interromper a
  gravação, remover arquivos parciais e liberar a reserva. Depois que a API
  responder `202`, a execução do job deverá continuar independente da conexão
  HTTP original.
- Tornar a reserva de bytes e de vagas atômica, evitando que uploads
  concorrentes ultrapassem `UPLOAD_MAX_TEMP_BYTES` ou
  `UPLOAD_MAX_PENDING_JOBS` entre a verificação e a gravação.
- Se o processo cair depois de gravar o arquivo, mas antes de persistir o job,
  tratar o arquivo como órfão e removê-lo durante a reconciliação.
- Se Redis cair durante a criação ou atualização do job, não aceitar o upload
  sem persistência: remover o arquivo temporário, liberar a reserva e
  responder com erro controlado de indisponibilidade.
- A política de durabilidade completa do Redis é definida na seção 6.2;
  esta seção apenas registra que a persistência durável sobre volume
  persistente é obrigatória.
- A reconciliação quando o worker morrer é definida na seção 6.1; aqui fica o
  requisito de não redisparar cegamente sem verificar o estado remoto.
- A correlação será feita com `messageId` persistido imediatamente após o
  envio remoto, uma marca técnica do `jobId` no conteúdo/metadado do upload e
  o estado `reconciliation_required` quando houver dúvida sobre a conclusão.
- Impedir mensagens Telegram duplicadas após uma queda entre o envio remoto e
  a persistência do resultado. A reconciliação deverá usar o identificador do
  job, o `messageId` persistido e uma busca remota quando necessário.
- A reconciliação tem orçamento finito de 5 tentativas; após esgotado, o job
  vai para `dead_letter` e não é mais processado automaticamente.
- Se a limpeza falhar, manter o job/arquivo marcado para nova tentativa e
  registrar erro observável; a falha de cleanup não pode liberar uma reserva
  ainda ocupada nem ocultar o problema.
- Validar que os caminhos do spool pertencem ao diretório configurado, não
  escapam por traversal ou links simbólicos e possuem permissões adequadas.
- O fluxo de encerramento gracioso detalhado é definido na seção 6.3; aqui
  fica o requisito de preservar jobs recuperáveis e não perder o estado final.
- Definir métricas e logs para capacidade de bytes/jobs, uso do spool, memória
  Redis, jobs presos, falhas de persistência, reconciliações e limpezas
  pendentes.

### 6. Casos operacionais fechados

#### 6.1 Duplicidade de mensagens no Telegram

- Persistir `jobId`, estado do job, `telegramMessageId` assim que houver
  sucesso, timestamps da tentativa e uma marca técnica de correlação.
- Antes de reenviar, verificar se já existe `telegramMessageId`; se existir,
  consultar o Telegram e concluir o job quando a mensagem remota for
  encontrada.
- Se não houver confirmação remota, registrar o job como
  `reconciliation_required` e só reenviar quando não houver evidência de
  mensagem criada.
- A marca de correlação deve permitir localizar a mensagem por job quando o
  `telegramMessageId` ainda não estiver persistido.
- **Orçamento de retry da reconciliação:**
  - Cada job `reconciliation_required` possui um contador `retryCount`
    persistido, incrementado a cada tentativa frustrada de reconciliação
    (falha na consulta ao Telegram, crash, timeout).
  - Nas primeiras 5 tentativas, a reconciliação procede normalmente.
  - Ao atingir 5 tentativas sem sucesso, o job é movido para o estado
    `dead_letter` e **nunca mais** é reconciliado ou reenviado
    automaticamente.
  - Jobs `dead_letter` exigem intervenção manual para investigação e
    limpeza.
  - Uma reconciliação bem-sucedida (mensagem remota encontrada) reseta o
    `retryCount` para zero no momento em que o job transiciona para
    `completed`.

#### 6.2 Durabilidade real do Redis

- A configuração escolhida é `appendonly yes`, `appendfsync everysec` e
  `maxmemory-policy noeviction`.
- O Redis grava estado e metadados da fila; os vídeos continuam no spool
  persistente.
- Também precisam ficar definidos volume em `/data`, rotação do AOF,
  restauração após desastre e teste de reinício abrupto.

#### 6.3 Encerramento gracioso

- Em `SIGTERM` ou `SIGINT`, a ordem é: bloquear admissões, parar novos jobs,
  deixar uploads ativos terminarem por tempo limitado, persistir o estado,
  marcar o que ficou incompleto para reconciliação e encerrar Bull, Redis e
  Telegram.
- O timeout fechado para esse fluxo é `60 segundos`.
- Depois do timeout, nada é marcado como concluído e o boot seguinte assume a
  reconciliação.

#### 6.4 Falha na limpeza

- Falha de cleanup não libera reserva enquanto o arquivo ainda existir.
- Remoção de arquivo ausente conta como sucesso.
- Outros erros de cleanup devem gerar retry e alerta observável.

#### 6.5 Contratos de erro

- Capacidade esgotada continua em `429` com `Retry-After: 60` e payload de
  capacidade.
- `ENOSPC` pode responder com `507` ou `503`, conforme o ponto do fluxo.
- Redis indisponível ou sem memória responde com `503`.
- Falhas de multipart, MIME, arquivo perdido e falha do Telegram viram erro do
  job, sem stack trace no polling.

#### 6.6 Segurança operacional

- O spool fica restrito a `UPLOAD_TEMP_DIR`, com `0700`, sem traversal, sem
  symlink inesperado e sem usar o nome original como nome físico.
- Limites de thumbnail, campos multipart e serialização binária no Bull
  continuam obrigatórios.
- `REDIS_URL`, TLS, exposição de rede, permissões e espaço livre do volume
  precisam ser tratados como requisitos operacionais.

#### 6.7 Decisões fechadas

- Correlação: `messageId` persistido imediatamente + marca técnica do `jobId`
  + `reconciliation_required` quando houver dúvida.
- Redis: `AOF` com `everysec`, combinado com snapshots `RDB`/backup.
- Encerramento: `60 segundos`, com jobs incompletos enviados para
  reconciliação.
- Reconciliação: orçamento de 5 tentativas, com dead-letter ao esgotar.

### 7. `UploadJobManager`

- Centralizar em um único módulo:
- criação do descritor;
- reserva de capacidade;
- criação do job Bull;
- transições `queued`, `paused`, `uploading`, `completed`, `error`,
  `cancelled` e `dead_letter`;
  - cancelamento soft;
  - execução;
  - settlement;
  - reconciliação após reinício com orçamento de retry e dead-letter;
  - limpeza dos arquivos temporários;
  - liberação de orçamento.
- As rotas de upload, progresso, pause, resume, cancel e operações em lote
  apenas traduzirão HTTP para operações do manager.
- O manager abrirá os caminhos dos arquivos apenas quando o worker adquirir
  uma vaga.
- A fila deverá expor internamente contagens de `waiting`, `active`,
  `paused`, `completed` e `failed`, para diagnóstico operacional e futura
  integração com dashboard.
- Downloads e streams não serão convertidos em jobs Bull: continuam como
  operações HTTP ativas, controladas por seus limites de concorrência e
  backpressure atuais.

## 8. Testes e validação

- Testes de unidade do manager para limites por bytes e quantidade, reservas,
  liberações, cancelamento, cleanup, pausa/resume, concorrência e requests
  chunked.
- Testes da interface Bull/Redis com adapter falso para a suíte unitária e de
  integração, sem exigir Redis local.
- Testes de integração opcionais com Redis real para confirmar:
  - persistência de jobs após reinício do processo;
  - recuperação de jobs `queued` e `paused`;
  - atualização de progresso e resultado;
  - remoção/cancelamento sem execução duplicada;
  - reconciliação de arquivos ausentes;
  - bloqueio de novos uploads quando Redis está indisponível.
- Testes de rota para `429` com `Retry-After`, rejeição antecipada por
  `Content-Length`, cleanup após rejeição/validação inválida, polling após
  reinício e ausência de retenção de `Request`/`Response` na fila.
- Testes de falha de armazenamento para simular `ENOSPC` durante o multipart,
  confirmando remoção do arquivo parcial, liberação das reservas, ausência de
  job órfão e resposta controlada de capacidade.
- Testes de recuperação para desconexão do cliente, reservas concorrentes,
  queda do processo em cada etapa, Redis indisponível durante gravações,
  worker morto durante `uploading`, reinício do Redis e limpeza que falha.
- Testes de reconciliação para confirmar que um envio Telegram parcialmente
  persistido não cria mensagem duplicada e que jobs recuperáveis não são
  redisparados sem verificar o estado remoto.
- Testes do orçamento de retry da reconciliação:
  - falha consistente incrementa `retryCount` até 5, após o que o job vai
    para `dead_letter`;
  - reconciliação bem-sucedida reseta o contador e conclui o job;
  - job `dead_letter` não é retomado em boots subsequentes;
  - métricas e logs emitidos para jobs em `dead_letter`.
- Testes de segurança do spool para rejeitar caminhos fora de
  `UPLOAD_TEMP_DIR`, traversal e links simbólicos indevidos.
- Teste de encerramento gracioso confirmando que novas admissões são
  bloqueadas, conexões são fechadas e jobs recuperáveis permanecem
  persistidos.
- Testes do adapter Telegram para confirmar vídeo file-backed, ausência de
  `CustomFile.buffer`, leitura em partes e thumbnail limitada.
- Criar cenário local de carga, fora da suíte padrão, com vários arquivos
  grandes e medição de RSS. O heap do Node não deve crescer
  proporcionalmente a `quantidade × tamanho_do_arquivo` nem reter closures para
  todos os jobs waiting.
- Executar `pnpm test`, `pnpm test:coverage`, `pnpm typecheck`, `pnpm lint`,
  `pnpm format:check` e `git diff --check`.

## 9. Documentação relacionada

- Atualizar `docs/ROUTES.md`, removendo a descrição de multipart “em memória” e
  documentando a persistência do job e o comportamento após reinício.
- Documentar os limites de bytes/jobs, a resposta `429` e a dependência de
  Redis para uploads.
- Atualizar `.env.sample` com as variáveis de Redis, limites de capacidade e
  spool persistente, incluindo `REDIS_MAX_MEMORY` e `UPLOAD_TEMP_DIR`.
- Atualizar `README.md` com a inicialização do Redis e o volume necessário para
  os arquivos temporários.
- Atualizar `docker-compose.yml` e, se necessário, o compose de desenvolvimento
  para incluir Redis com healthcheck e volume persistente.
- Atualizar `docs/insomnia/Insomnia.yaml` com limites, comportamento de
  capacidade, polling persistente e contrato de erro.

## 10. Assumptions

- Os padrões são `10 GiB`, `50 jobs` e `Retry-After: 60`.
- `REDIS_MAX_MEMORY` será configurado explicitamente por ambiente e usará
  `maxmemory-policy noeviction`; o valor de `50 jobs` não substitui o limite
  de memória do Redis.
- O contrato HTTP e os estados existentes não serão quebrados.
- Redis será obrigatório para aceitar e processar uploads; se atingir o limite
  de memória, novas admissões falharão sem eviction de jobs existentes.
- O spool de arquivos temporários será persistente, configurado por
  `UPLOAD_TEMP_DIR` e acessível ao processo do worker após reinícios.
- A concorrência efetiva do Telegram continuará controlada por
  `UPLOAD_CONCURRENCY_LIMIT`.
- A fila Bull será usada somente para uploads; streams e downloads não serão
  persistidos como jobs.
- A primeira implementação usará Bull clássico; uma migração para BullMQ fica
  como decisão futura, não como parte deste plano.
