import input from 'input';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions';
import config from './config';

async function main(): Promise<void> {
  const client = new TelegramClient(new StringSession(config.session), config.apiId, config.apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => input.text('Número de telefone (com código do país, ex: +5511999999999): '),
    password: async () => input.text('Senha de verificação em duas etapas (deixe em branco se não tiver): '),
    phoneCode: async () => input.text('Código enviado pelo Telegram: '),
    onError: (err: Error) => console.error(err),
  });

  console.log('\nLogin concluído! Cole a linha abaixo no seu .env como TELEGRAM_SESSION:\n');
  console.log(client.session.save());

  await client.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
