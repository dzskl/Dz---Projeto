import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@tg/config';
import { prisma, type Admin, type Session } from '@tg/database';

/**
 * Sessoes de administrador.
 *
 * O token vive apenas no cookie do navegador; o banco guarda somente o seu
 * SHA-256. Assim, um vazamento do banco nao permite assumir sessao de ninguem —
 * ao contrario de JWT, que tambem nao permitiria revogar acesso na hora.
 *
 * SHA-256 (e nao Argon2) e adequado aqui porque o token ja e aleatorio de 256
 * bits: nao ha o que adivinhar por forca bruta, e a verificacao precisa ser
 * rapida — ela roda em toda requisicao.
 */

/** Nome do cookie de sessao. */
export const SESSION_COOKIE = 'tg_session';

export interface SessionWithAdmin extends Session {
  admin: Admin;
}

@Injectable()
export class SessionService {
  /** Deriva a chave de busca a partir do token bruto. */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Cria uma sessao e devolve o token bruto.
   *
   * O token bruto nao e persistido em lugar nenhum — este e o unico momento em
   * que ele existe fora do navegador.
   */
  async create(
    adminId: string,
    context: { ip?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + getEnv().SESSION_TTL_HOURS * 3_600_000);

    await prisma.session.create({
      data: {
        adminId,
        tokenHash: this.hashToken(token),
        expiresAt,
        ip: context.ip ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Valida um token e devolve a sessao com o admin.
   *
   * Retorna null para qualquer motivo de invalidez (inexistente, expirada,
   * revogada, admin desativado) — quem chama nao precisa distinguir, e nao
   * revelamos o motivo ao cliente.
   */
  async validate(token: string): Promise<SessionWithAdmin | null> {
    if (!token) return null;

    const session = await prisma.session.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { admin: true },
    });

    if (!session) return null;
    if (session.revokedAt) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    if (!session.admin.isActive) return null;

    return session;
  }

  /** Revoga uma sessao especifica (logout). */
  async revoke(token: string): Promise<void> {
    await prisma.session.updateMany({
      where: { tokenHash: this.hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revoga todas as sessoes de um admin.
   *
   * Usado ao trocar senha ou desativar a conta: quem estiver logado em outro
   * dispositivo perde o acesso imediatamente.
   */
  async revokeAllForAdmin(adminId: string): Promise<number> {
    const { count } = await prisma.session.updateMany({
      where: { adminId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Remove sessoes expiradas ha mais de 30 dias. */
  async purgeExpired(): Promise<number> {
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const { count } = await prisma.session.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    return count;
  }

  /**
   * Comparacao de strings em tempo constante.
   *
   * Disponivel para comparar segredos de tamanho fixo (por exemplo, o
   * secret_token do webhook do Telegram na Fase 2), onde `===` vazaria
   * informacao pelo tempo de resposta.
   */
  static safeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
