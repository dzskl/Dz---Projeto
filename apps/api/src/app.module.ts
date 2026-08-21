import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BotsModule } from './bots/bots.module';
import { CampanhasModule } from './campanhas/campanhas.module';
import { ContatosModule } from './contatos/contatos.module';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { FilaModule } from './fila/fila.module';
import { HealthModule } from './health/health.module';
import { TelegramModule } from './telegram/telegram.module';
import { UpdatesModule } from './updates/updates.module';

/**
 * Modulo raiz.
 *
 * Guards e filtro sao registrados globalmente: a protecao e o formato de erro
 * valem para toda rota nova sem precisar lembrar de aplica-los. A ordem importa
 * — AuthGuard preenche request.admin, que o RolesGuard le em seguida.
 */
@Module({
  imports: [AuditModule, AuthModule, UpdatesModule, TelegramModule, BotsModule, ContatosModule, FilaModule, CampanhasModule, HealthModule],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
