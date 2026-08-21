import { Global, Module } from '@nestjs/common';
import { UpdateProcessorService } from './update-processor.service';
import { UpdatesService } from './updates.service';

/**
 * Processamento de updates.
 *
 * Global porque o controlador de webhook (no modulo Telegram) precisa agendar o
 * processamento logo apos gravar.
 */
@Global()
@Module({
  providers: [UpdateProcessorService, UpdatesService],
  exports: [UpdateProcessorService, UpdatesService],
})
export class UpdatesModule {}
