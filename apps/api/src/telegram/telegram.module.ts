import { Global, Module } from '@nestjs/common';
import { GrammyApiFactory } from './grammy-api.factory';
import { TELEGRAM_API_FACTORY } from './telegram.types';
import { WebhookController } from './webhook.controller';

/**
 * Acesso ao Telegram.
 *
 * A fabrica e registrada pelo simbolo TELEGRAM_API_FACTORY para que os testes
 * substituam a implementacao sem tocar nos servicos que a consomem.
 */
@Global()
@Module({
  controllers: [WebhookController],
  providers: [{ provide: TELEGRAM_API_FACTORY, useClass: GrammyApiFactory }],
  exports: [TELEGRAM_API_FACTORY],
})
export class TelegramModule {}
