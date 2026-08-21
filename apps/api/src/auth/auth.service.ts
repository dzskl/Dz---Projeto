import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import {
  AuditAction,
  ConflictError,
  InvalidCredentialsError,
  type AdminPublic,
  type ChangePasswordInput,
  type CreateAdminInput,
  type LoginInput,
} from '@tg/shared';
import { prisma, type Admin } from '@tg/database';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';

/**
 * Parametros do Argon2id.
 *
 * Recomendacao OWASP: 19 MiB de memoria, 2 iteracoes, paralelismo 1. O custo de
 * memoria e o que encarece ataque com GPU.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash descartavel usado quando o e-mail nao existe.
 *
 * Sem ele, um login com e-mail inexistente responderia muito mais rapido do que
 * um com e-mail valido e senha errada — o que permite descobrir quais e-mails
 * tem conta apenas medindo o tempo de resposta.
 *
 * E gerado no boot (a partir de uma senha aleatoria) em vez de ficar fixo no
 * codigo: assim tem exatamente os mesmos parametros de custo dos hashes reais.
 * Um valor escrito a mao poderia ter custo diferente e o proprio tempo de
 * verificacao entregaria que aquela conta nao existe.
 */
let dummyHashPromise: Promise<string> | null = null;

function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  return dummyHashPromise;
}

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /** Converte o registro do banco no formato publico (sem hash de senha). */
  static toPublic(admin: Admin): AdminPublic {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      isActive: admin.isActive,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
    };
  }

  /**
   * Autentica e abre sessao.
   *
   * Toda falha devolve a mesma mensagem generica: distinguir "e-mail nao existe"
   * de "senha errada" entregaria a lista de contas a quem tentar adivinhar.
   */
  async login(
    input: LoginInput,
    ctx: RequestContext,
  ): Promise<{ admin: AdminPublic; token: string; expiresAt: Date }> {
    const admin = await prisma.admin.findUnique({ where: { email: input.email } });

    // Sempre executa uma verificacao, mesmo sem conta, para o tempo nao variar.
    const passwordOk = await verify(
      admin?.passwordHash ?? (await getDummyHash()),
      input.password,
    ).catch(() => false);

    if (!admin || !passwordOk || !admin.isActive) {
      await this.audit.record({
        action: AuditAction.LOGIN_FAILED,
        adminId: admin?.id ?? null,
        metadata: { email: input.email },
        ...ctx,
      });
      throw new InvalidCredentialsError();
    }

    const { token, expiresAt } = await this.sessions.create(admin.id, ctx);

    await prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({ action: AuditAction.LOGIN, adminId: admin.id, ...ctx });

    return { admin: AuthService.toPublic(admin), token, expiresAt };
  }

  async logout(token: string, adminId: string, ctx: RequestContext): Promise<void> {
    await this.sessions.revoke(token);
    await this.audit.record({ action: AuditAction.LOGOUT, adminId, ...ctx });
  }

  /** Cria um administrador. */
  async createAdmin(
    input: CreateAdminInput,
    actorId: string,
    ctx: RequestContext,
  ): Promise<AdminPublic> {
    const existing = await prisma.admin.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ConflictError('Ja existe uma conta com este e-mail.');
    }

    const admin = await prisma.admin.create({
      data: {
        email: input.email,
        name: input.name,
        role: input.role,
        passwordHash: await hash(input.password, ARGON2_OPTIONS),
      },
    });

    await this.audit.record({
      action: AuditAction.ADMIN_CREATED,
      adminId: actorId,
      entityType: 'Admin',
      entityId: admin.id,
      metadata: { email: admin.email, role: admin.role },
      ...ctx,
    });

    return AuthService.toPublic(admin);
  }

  /**
   * Troca a senha do proprio usuario.
   *
   * Todas as sessoes sao revogadas em seguida — inclusive a atual. Se a troca
   * aconteceu porque a senha vazou, manter sessoes abertas anularia o efeito.
   */
  async changePassword(
    adminId: string,
    input: ChangePasswordInput,
    ctx: RequestContext,
  ): Promise<void> {
    const admin = await prisma.admin.findUnique({ where: { id: adminId } });
    if (!admin) throw new InvalidCredentialsError();

    const ok = await verify(admin.passwordHash, input.currentPassword).catch(() => false);
    if (!ok) throw new InvalidCredentialsError();

    await prisma.admin.update({
      where: { id: adminId },
      data: { passwordHash: await hash(input.newPassword, ARGON2_OPTIONS) },
    });

    const revoked = await this.sessions.revokeAllForAdmin(adminId);

    await this.audit.record({
      action: AuditAction.ADMIN_UPDATED,
      adminId,
      entityType: 'Admin',
      entityId: adminId,
      metadata: { change: 'password', sessionsRevoked: revoked },
      ...ctx,
    });
  }
}
