import { Global, Module } from '@nestjs/common';
import { EnvioService } from './envio.service';

/** Global: o servico de campanhas precisa enfileirar. */
@Global()
@Module({
  providers: [EnvioService],
  exports: [EnvioService],
})
export class FilaModule {}
