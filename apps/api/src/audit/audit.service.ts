import { Injectable } from '@nestjs/common';
import { createLogger } from '@tg/config';
import { prisma, type Prisma } from '@tg/database';

const logger = createLogger('audit');

export interface AuditEntry {
  action: string;
  adminId?: string | null;
  entityType?: string;
  entityId?: string;
  ip?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Trilha de auditoria.
 *
 * Registra quem fez o que. Falha de auditoria nunca derruba a operacao: se o
 * registro nao puder ser gravado, o erro e logado e a acao segue. Bloquear um
 * logout porque a auditoria falhou seria pior do que perder uma linha de log.
 */
@Injectable()
export class AuditService {
  async record(entry: AuditEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          action: entry.action,
          adminId: entry.adminId ?? null,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: entry.metadata,
        },
      });
    } catch (err) {
      logger.error(
        { err, action: entry.action, adminId: entry.adminId },
        'falha ao gravar auditoria',
      );
    }
  }
}
