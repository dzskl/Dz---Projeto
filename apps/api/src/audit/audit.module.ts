import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: praticamente todo modulo registra auditoria. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
