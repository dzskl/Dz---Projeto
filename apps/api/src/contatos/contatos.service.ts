import { Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@tg/database';
import {
  AuditAction,
  NotFoundError,
  type ContatoPublico,
  type CriarOptOutInput,
  type ListarContatosInput,
  type OptOutPublico,
  type PaginaDeContatos,
} from '@tg/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../auth/auth.service';

/** Vinculo com pessoa e bot carregados, como as consultas deste servico pedem. */
type VinculoCompleto = Prisma.BotUserGetPayload<{
  include: {
    telegramUser: true;
    bot: { select: { id: true; username: true } };
  };
}>;

@Injectable()
export class ContatosService {
  constructor(private readonly audit: AuditService) {}

  private static nomeDe(pessoa: { firstName: string | null; lastName: string | null }): string {
    const nome = [pessoa.firstName, pessoa.lastName].filter(Boolean).join(' ').trim();
    return nome || 'Sem nome';
  }

  private static toPublic(vinculo: VinculoCompleto, temOptOut: boolean): ContatoPublico {
    return {
      id: vinculo.id,
      telegramUserId: vinculo.telegramUser.id,
      nome: ContatosService.nomeDe(vinculo.telegramUser),
      username: vinculo.telegramUser.username,
      status: vinculo.status,
      origemConsentimento: vinculo.consentSource,
      consentimentoEm: vinculo.consentAt.toISOString(),
      origemCampanha: vinculo.consentPayload,
      ultimaInteracaoEm: vinculo.lastInteractionAt?.toISOString() ?? null,
      /**
       * Tres condicoes para poder receber, e todas sao obrigatorias:
       * estar ativo, ter chat privado aberto (sem ele o envio e impossivel) e
       * nao estar na lista de opt-out.
       */
      podeReceber: vinculo.status === 'ACTIVE' && vinculo.privateChatId !== null && !temOptOut,
      bot: { id: vinculo.bot.id, username: vinculo.bot.username },
    };
  }

  async listar(filtros: ListarContatosInput): Promise<PaginaDeContatos> {
    const where: Prisma.BotUserWhereInput = {
      ...(filtros.botId ? { botId: filtros.botId } : {}),
      ...(filtros.status ? { status: filtros.status } : {}),
      ...(filtros.busca
        ? {
            telegramUser: {
              OR: [
                { firstName: { contains: filtros.busca, mode: 'insensitive' } },
                { lastName: { contains: filtros.busca, mode: 'insensitive' } },
                { username: { contains: filtros.busca, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const [vinculos, total, elegiveis] = await Promise.all([
      prisma.botUser.findMany({
        where,
        include: { telegramUser: true, bot: { select: { id: true, username: true } } },
        orderBy: { lastInteractionAt: { sort: 'desc', nulls: 'last' } },
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
      }),
      prisma.botUser.count({ where }),
      prisma.botUser.count({
        where: {
          ...(filtros.botId ? { botId: filtros.botId } : {}),
          status: 'ACTIVE',
          privateChatId: { not: null },
        },
      }),
    ]);

    /**
     * Opt-outs dos contatos desta pagina, numa consulta so.
     *
     * Buscar por contato seria uma consulta por linha; aqui e uma para a pagina
     * inteira. O opt-out global (botId nulo) vale para qualquer bot.
     */
    const pessoaIds = vinculos.map((v) => v.telegramUserId);
    const optOuts = pessoaIds.length
      ? await prisma.optOut.findMany({
          where: { telegramUserId: { in: pessoaIds } },
          select: { telegramUserId: true, botId: true },
        })
      : [];

    const bloqueio = new Set(
      optOuts.map((o) => `${o.telegramUserId}:${o.botId ?? 'global'}`),
    );
    const temOptOut = (v: VinculoCompleto): boolean =>
      bloqueio.has(`${v.telegramUserId}:${v.botId}`) ||
      bloqueio.has(`${v.telegramUserId}:global`);

    return {
      contatos: vinculos.map((v) => ContatosService.toPublic(v, temOptOut(v))),
      total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      totalElegiveis: elegiveis,
    };
  }

  async listarOptOuts(): Promise<OptOutPublico[]> {
    const registros = await prisma.optOut.findMany({
      include: {
        telegramUser: true,
        bot: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return registros.map((r) => ({
      id: r.id,
      telegramUserId: r.telegramUser.id,
      nome: ContatosService.nomeDe(r.telegramUser),
      username: r.telegramUser.username,
      botId: r.bot?.id ?? null,
      botUsername: r.bot?.username ?? null,
      motivo: r.reason,
      observacao: r.note,
      criadoEm: r.createdAt.toISOString(),
    }));
  }

  /**
   * Adiciona alguem a lista de opt-out manualmente.
   *
   * Exige justificativa: opt-out manual e decisao administrativa que tira uma
   * pessoa da base, e o motivo precisa ficar registrado.
   */
  async criarOptOut(
    input: CriarOptOutInput,
    actorId: string,
    ctx: RequestContext,
  ): Promise<OptOutPublico> {
    const pessoa = await prisma.telegramUser.findUnique({
      where: { id: input.telegramUserId },
    });
    if (!pessoa) throw new NotFoundError('Contato');

    const registro = await prisma.optOut.upsert({
      where: {
        botId_telegramUserId: {
          botId: input.botId as string,
          telegramUserId: input.telegramUserId,
        },
      },
      create: {
        botId: input.botId,
        telegramUserId: input.telegramUserId,
        reason: 'MANUAL',
        note: input.motivo,
        createdByAdminId: actorId,
      },
      update: { reason: 'MANUAL', note: input.motivo, createdByAdminId: actorId },
      include: { telegramUser: true, bot: { select: { id: true, username: true } } },
    });

    // Refletir no vinculo: quem entrou no opt-out deixa de ser elegivel.
    await prisma.botUser.updateMany({
      where: {
        telegramUserId: input.telegramUserId,
        ...(input.botId ? { botId: input.botId } : {}),
        status: 'ACTIVE',
      },
      data: { status: 'UNSUBSCRIBED', statusChangedAt: new Date() },
    });

    await this.audit.record({
      action: AuditAction.OPT_OUT_ADDED,
      adminId: actorId,
      entityType: 'OptOut',
      entityId: registro.id,
      metadata: { telegramUserId: input.telegramUserId, botId: input.botId, motivo: input.motivo },
      ...ctx,
    });

    return {
      id: registro.id,
      telegramUserId: registro.telegramUser.id,
      nome: ContatosService.nomeDe(registro.telegramUser),
      username: registro.telegramUser.username,
      botId: registro.bot?.id ?? null,
      botUsername: registro.bot?.username ?? null,
      motivo: registro.reason,
      observacao: registro.note,
      criadoEm: registro.createdAt.toISOString(),
    };
  }

  /**
   * Remove um opt-out.
   *
   * Nao reativa o contato: voltar a receber depende de a propria pessoa mandar
   * /start. Reativar por decisao administrativa desfaria o consentimento.
   */
  async removerOptOut(id: string, actorId: string, ctx: RequestContext): Promise<void> {
    const registro = await prisma.optOut.findUnique({ where: { id } });
    if (!registro) throw new NotFoundError('Opt-out');

    await prisma.optOut.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.OPT_OUT_REMOVED,
      adminId: actorId,
      entityType: 'OptOut',
      entityId: id,
      metadata: { telegramUserId: registro.telegramUserId, botId: registro.botId },
      ...ctx,
    });
  }
}
