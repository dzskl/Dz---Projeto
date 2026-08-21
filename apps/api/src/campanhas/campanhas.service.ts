import { Injectable } from '@nestjs/common';
import { createLogger } from '@tg/config';
import { Prisma, prisma, type Campaign } from '@tg/database';
import {
  AuditAction,
  CAMPAIGN_TRANSITIONS,
  ConflictError,
  DomainError,
  ErrorCode,
  InvalidStateTransitionError,
  NotFoundError,
  canTransition,
  type AtualizarCampanhaInput,
  type BotaoInput,
  type CampaignStatus,
  type CampanhaPublica,
  type CriarCampanhaInput,
  type FiltroPublicoInput,
  type MensagemInput,
  type PreviaDoPublico,
} from '@tg/shared';
import { AuditService } from '../audit/audit.service';
import { EnvioService } from '../fila/envio.service';
import type { RequestContext } from '../auth/auth.service';
import { filaDoBot, opcoesDoJob } from '../fila/fila';

const logger = createLogger('campanhas');

/** Quantos destinatarios sao materializados por vez. */
const LOTE_MATERIALIZACAO = 1_000;

type CampanhaCompleta = Prisma.CampaignGetPayload<{
  include: {
    bot: { select: { id: true; username: true } };
    messages: true;
  };
}>;

@Injectable()
export class CampanhasService {
  constructor(
    private readonly audit: AuditService,
    private readonly envio: EnvioService,
  ) {}

  private static toPublic(campanha: CampanhaCompleta): CampanhaPublica {
    return {
      id: campanha.id,
      nome: campanha.name,
      status: campanha.status,
      bot: { id: campanha.bot.id, username: campanha.bot.username },
      mensagens: campanha.messages
        .sort((a, b) => a.order - b.order)
        .map((m) => ({
          id: m.id,
          ordem: m.order,
          kind: m.kind,
          texto: m.text,
          legenda: m.caption,
          mediaAssetId: m.mediaAssetId,
          botoes: (m.buttons as BotaoInput[] | null) ?? null,
        })),
      filtro: (campanha.audienceFilter as FiltroPublicoInput | null) ?? null,
      ratePerSecond: campanha.ratePerSecond,
      agendadaPara: campanha.scheduledAt?.toISOString() ?? null,
      iniciadaEm: campanha.startedAt?.toISOString() ?? null,
      finalizadaEm: campanha.finishedAt?.toISOString() ?? null,
      totalDestinatarios: campanha.totalRecipients,
      enviados: campanha.sentCount,
      falhas: campanha.failedCount,
      bloqueados: campanha.blockedCount,
      ignorados: campanha.skippedCount,
      criadaEm: campanha.createdAt.toISOString(),
    };
  }

  /**
   * Monta o filtro do publico elegivel.
   *
   * As tres primeiras condicoes nao sao negociaveis e valem sempre: estar ativo,
   * ter conversa privada aberta (sem ela o envio e impossivel) e nao estar em
   * opt-out. O filtro escolhido pelo administrador so restringe ainda mais — ele
   * nunca consegue alcancar quem esta fora dessa base.
   *
   * O opt-out e verificado por relacao (NOT EXISTS no SQL) em vez de carregar a
   * lista em memoria: numa base grande, trazer todos os opt-outs para filtrar no
   * Node nao escala.
   */
  private static filtroDeElegiveis(
    botId: string,
    filtro?: FiltroPublicoInput | null,
  ): Prisma.BotUserWhereInput {
    const where: Prisma.BotUserWhereInput = {
      botId,
      status: 'ACTIVE',
      privateChatId: { not: null },
      telegramUser: {
        optOuts: { none: { OR: [{ botId }, { botId: null }] } },
      },
    };

    if (filtro?.interagiuNosUltimosDias) {
      where.lastInteractionAt = {
        gte: new Date(Date.now() - filtro.interagiuNosUltimosDias * 86_400_000),
      };
    }
    if (filtro?.origemConsentimento) where.consentSource = filtro.origemConsentimento;
    if (filtro?.origemCampanha) where.consentPayload = filtro.origemCampanha;

    return where;
  }

  async criar(
    input: CriarCampanhaInput,
    actorId: string,
    ctx: RequestContext,
  ): Promise<CampanhaPublica> {
    const bot = await prisma.bot.findUnique({ where: { id: input.botId } });
    if (!bot) throw new NotFoundError('Bot');

    const campanha = await prisma.campaign.create({
      data: {
        name: input.nome,
        botId: input.botId,
        ratePerSecond: input.ratePerSecond,
        audienceFilter: (input.filtro ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduledAt: input.agendadaPara ? new Date(input.agendadaPara) : null,
        status: input.agendadaPara ? 'SCHEDULED' : 'DRAFT',
        createdByAdminId: actorId,
        messages: {
          create: input.mensagens.map((m, i) => CampanhasService.dadosDaMensagem(m, i)),
        },
      },
      include: { bot: { select: { id: true, username: true } }, messages: true },
    });

    await this.audit.record({
      action: AuditAction.CAMPAIGN_CREATED,
      adminId: actorId,
      entityType: 'Campaign',
      entityId: campanha.id,
      metadata: { nome: input.nome, botId: input.botId },
      ...ctx,
    });

    return CampanhasService.toPublic(campanha);
  }

  private static dadosDaMensagem(m: MensagemInput, indice: number): Prisma.CampaignMessageUncheckedCreateWithoutCampaignInput {
    return {
      order: indice,
      kind: m.kind,
      text: m.texto ?? null,
      caption: m.legenda ?? null,
      mediaAssetId: m.mediaAssetId ?? null,
      buttons: (m.botoes ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  }

  async listar(botId?: string): Promise<CampanhaPublica[]> {
    const campanhas = await prisma.campaign.findMany({
      where: botId ? { botId } : {},
      include: { bot: { select: { id: true, username: true } }, messages: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return campanhas.map((c) => CampanhasService.toPublic(c));
  }

  async buscar(id: string): Promise<CampanhaPublica> {
    const campanha = await prisma.campaign.findUnique({
      where: { id },
      include: { bot: { select: { id: true, username: true } }, messages: true },
    });
    if (!campanha) throw new NotFoundError('Campanha');
    return CampanhasService.toPublic(campanha);
  }

  /**
   * Previa do publico.
   *
   * Deixa claro, antes do disparo, quantas pessoas realmente receberiam — e
   * quanto tempo o envio deve levar no ritmo configurado.
   */
  async preverPublico(id: string): Promise<PreviaDoPublico> {
    const campanha = await prisma.campaign.findUnique({ where: { id } });
    if (!campanha) throw new NotFoundError('Campanha');

    const filtro = campanha.audienceFilter as FiltroPublicoInput | null;
    const [elegiveis, totalNoBot] = await Promise.all([
      prisma.botUser.count({
        where: CampanhasService.filtroDeElegiveis(campanha.botId, filtro),
      }),
      prisma.botUser.count({ where: { botId: campanha.botId } }),
    ]);

    return {
      elegiveis,
      totalNoBot,
      duracaoEstimadaSegundos: Math.ceil(elegiveis / campanha.ratePerSecond),
    };
  }

  async atualizar(
    id: string,
    input: AtualizarCampanhaInput,
    actorId: string,
    ctx: RequestContext,
  ): Promise<CampanhaPublica> {
    const campanha = await prisma.campaign.findUnique({ where: { id } });
    if (!campanha) throw new NotFoundError('Campanha');

    // Depois de iniciada, mudar conteudo ou publico produziria uma campanha em
    // que parte das pessoas recebeu uma coisa e parte outra.
    if (campanha.status !== 'DRAFT' && campanha.status !== 'SCHEDULED') {
      throw new ConflictError('So e possivel editar campanhas em rascunho ou agendadas.');
    }

    const atualizada = await prisma.campaign.update({
      where: { id },
      data: {
        ...(input.nome !== undefined ? { name: input.nome } : {}),
        ...(input.ratePerSecond !== undefined ? { ratePerSecond: input.ratePerSecond } : {}),
        ...(input.filtro !== undefined
          ? { audienceFilter: (input.filtro ?? Prisma.DbNull) as Prisma.InputJsonValue }
          : {}),
        ...(input.agendadaPara !== undefined
          ? {
              scheduledAt: input.agendadaPara ? new Date(input.agendadaPara) : null,
              status: input.agendadaPara ? 'SCHEDULED' : 'DRAFT',
            }
          : {}),
        ...(input.mensagens
          ? {
              // Substituicao completa: manter as antigas e criar novas
              // bagunçaria a ordem de envio.
              messages: {
                deleteMany: {},
                create: input.mensagens.map((m, i) => CampanhasService.dadosDaMensagem(m, i)),
              },
            }
          : {}),
      },
      include: { bot: { select: { id: true, username: true } }, messages: true },
    });

    await this.audit.record({
      action: AuditAction.CAMPAIGN_UPDATED,
      adminId: actorId,
      entityType: 'Campaign',
      entityId: id,
      ...ctx,
    });

    return CampanhasService.toPublic(atualizada);
  }

  /** Aplica uma transicao de status, recusando as invalidas. */
  private async transicionar(campanha: Campaign, destino: CampaignStatus): Promise<void> {
    if (!canTransition(campanha.status, destino)) {
      throw new InvalidStateTransitionError(campanha.status, destino);
    }
  }

  /**
   * Materializa a lista de destinatarios.
   *
   * A lista e congelada no inicio da campanha. Isso da tres coisas: contagem
   * exata desde o comeco, retomada apos queda sem reprocessar tudo, e registro
   * de quem deveria receber o que.
   *
   * `skipDuplicates` combinado com o indice unico (campaign_id, bot_user_id)
   * torna a operacao repetivel: se o processo cair no meio, chamar de novo
   * completa o que faltou sem duplicar ninguem.
   */
  private async materializar(campanhaId: string, botId: string, filtro: FiltroPublicoInput | null): Promise<number> {
    const where = CampanhasService.filtroDeElegiveis(botId, filtro);
    let criados = 0;
    let cursor: string | undefined;

    for (;;) {
      const lote = await prisma.botUser.findMany({
        where,
        select: { id: true },
        orderBy: { id: 'asc' },
        take: LOTE_MATERIALIZACAO,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (lote.length === 0) break;

      const { count } = await prisma.campaignRecipient.createMany({
        data: lote.map((u) => ({ campaignId: campanhaId, botUserId: u.id })),
        skipDuplicates: true,
      });
      criados += count;
      cursor = lote[lote.length - 1]?.id;

      if (lote.length < LOTE_MATERIALIZACAO) break;
    }

    return criados;
  }

  /** Enfileira os destinatarios pendentes. Repetivel. */
  private async enfileirar(campanhaId: string, botId: string): Promise<number> {
    const fila = filaDoBot(botId);
    let enfileirados = 0;
    let cursor: string | undefined;

    for (;;) {
      const lote = await prisma.campaignRecipient.findMany({
        where: { campaignId: campanhaId, status: 'PENDING' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: LOTE_MATERIALIZACAO,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (lote.length === 0) break;

      await fila.addBulk(
        lote.map((r) => ({
          name: 'enviar',
          data: { campanhaId, destinatarioId: r.id, botId },
          opts: {
            ...opcoesDoJob(),
            /**
             * jobId igual ao id do destinatario.
             *
             * O BullMQ recusa jobs com id repetido, entao reenfileirar apos uma
             * queda nao cria envio duplicado — a garantia existe na fila alem
             * de existir no banco.
             */
            jobId: r.id,
          },
        })),
      );

      await prisma.campaignRecipient.updateMany({
        where: { id: { in: lote.map((r) => r.id) } },
        data: { status: 'QUEUED', queuedAt: new Date() },
      });

      enfileirados += lote.length;
      cursor = lote[lote.length - 1]?.id;
      if (lote.length < LOTE_MATERIALIZACAO) break;
    }

    return enfileirados;
  }

  /**
   * Inicia a campanha.
   *
   * A ordem e deliberada: marca RUNNING antes de enfileirar. Se fosse o
   * contrario, um worker poderia pegar um job de uma campanha ainda em DRAFT e
   * recusar o envio.
   */
  async iniciar(id: string, actorId: string, ctx: RequestContext): Promise<CampanhaPublica> {
    const campanha = await prisma.campaign.findUnique({
      where: { id },
      include: { bot: true, messages: true },
    });
    if (!campanha) throw new NotFoundError('Campanha');
    await this.transicionar(campanha, 'RUNNING');

    if (campanha.messages.length === 0) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'A campanha nao tem mensagens.');
    }
    if (!campanha.bot.isActive || campanha.bot.status !== 'CONNECTED') {
      throw new ConflictError('O bot desta campanha nao esta conectado.');
    }

    const filtro = campanha.audienceFilter as FiltroPublicoInput | null;
    const total = await this.materializar(id, campanha.botId, filtro);

    if (total === 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        'Nenhum contato elegivel para esta campanha.',
      );
    }

    await prisma.campaign.update({
      where: { id },
      data: { status: 'RUNNING', startedAt: new Date(), totalRecipients: total },
    });

    // O worker precisa existir ANTES dos jobs: enfileirar sem consumidor deixa
    // a campanha parada em RUNNING com a fila cheia.
    this.envio.garantirWorkerAutomatico(campanha.botId, campanha.ratePerSecond);

    const enfileirados = await this.enfileirar(id, campanha.botId);
    logger.info({ campanhaId: id, total, enfileirados }, 'campanha iniciada');

    await this.audit.record({
      action: AuditAction.CAMPAIGN_STARTED,
      adminId: actorId,
      entityType: 'Campaign',
      entityId: id,
      metadata: { totalDestinatarios: total },
      ...ctx,
    });

    return this.buscar(id);
  }

  /**
   * Pausa a campanha.
   *
   * Pausar a fila do bot pararia tambem as outras campanhas dele, entao o que se
   * faz e remover da fila os jobs desta campanha que ainda nao comecaram e
   * devolver os destinatarios para PENDING. Retomar reenfileira.
   */
  async pausar(id: string, actorId: string, ctx: RequestContext): Promise<CampanhaPublica> {
    const campanha = await prisma.campaign.findUnique({ where: { id } });
    if (!campanha) throw new NotFoundError('Campanha');
    await this.transicionar(campanha, 'PAUSED');

    await prisma.campaign.update({ where: { id }, data: { status: 'PAUSED' } });
    await this.removerJobsPendentes(id, campanha.botId);

    await this.audit.record({
      action: AuditAction.CAMPAIGN_PAUSED,
      adminId: actorId,
      entityType: 'Campaign',
      entityId: id,
      ...ctx,
    });

    return this.buscar(id);
  }

  async retomar(id: string, actorId: string, ctx: RequestContext): Promise<CampanhaPublica> {
    const campanha = await prisma.campaign.findUnique({ where: { id } });
    if (!campanha) throw new NotFoundError('Campanha');
    await this.transicionar(campanha, 'RUNNING');

    await prisma.campaign.update({ where: { id }, data: { status: 'RUNNING' } });
    this.envio.garantirWorkerAutomatico(campanha.botId, campanha.ratePerSecond);
    const enfileirados = await this.enfileirar(id, campanha.botId);

    await this.audit.record({
      action: AuditAction.CAMPAIGN_RESUMED,
      adminId: actorId,
      entityType: 'Campaign',
      entityId: id,
      metadata: { enfileirados },
      ...ctx,
    });

    return this.buscar(id);
  }

  async cancelar(id: string, actorId: string, ctx: RequestContext): Promise<CampanhaPublica> {
    const campanha = await prisma.campaign.findUnique({ where: { id } });
    if (!campanha) throw new NotFoundError('Campanha');
    await this.transicionar(campanha, 'CANCELLED');

    await prisma.campaign.update({
      where: { id },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    await this.removerJobsPendentes(id, campanha.botId);

    // Quem nunca chegou a ser enviado fica registrado como ignorado, para o
    // total continuar batendo: enviados + falhas + bloqueados + ignorados.
    const { count } = await prisma.campaignRecipient.updateMany({
      where: { campaignId: id, status: { in: ['PENDING', 'QUEUED'] } },
      data: { status: 'SKIPPED' },
    });
    await prisma.campaign.update({
      where: { id },
      data: { skippedCount: { increment: count } },
    });

    await this.audit.record({
      action: AuditAction.CAMPAIGN_CANCELLED,
      adminId: actorId,
      entityType: 'Campaign',
      entityId: id,
      metadata: { ignorados: count },
      ...ctx,
    });

    return this.buscar(id);
  }

  /** Remove da fila os jobs ainda nao iniciados desta campanha. */
  private async removerJobsPendentes(campanhaId: string, botId: string): Promise<void> {
    const fila = filaDoBot(botId);
    const pendentes = await prisma.campaignRecipient.findMany({
      where: { campaignId: campanhaId, status: 'QUEUED' },
      select: { id: true },
    });

    await Promise.all(
      pendentes.map(async (r) => {
        // O jobId e o id do destinatario; um job ja em execucao nao e removido,
        // e tudo bem — ele termina e contabiliza normalmente.
        const job = await fila.getJob(r.id);
        await job?.remove().catch(() => undefined);
      }),
    );

    await prisma.campaignRecipient.updateMany({
      where: { campaignId: campanhaId, status: 'QUEUED' },
      data: { status: 'PENDING', queuedAt: null },
    });
  }

  /** Transicoes possiveis a partir do estado atual, para o painel. */
  static acoesPossiveis(status: CampaignStatus): readonly CampaignStatus[] {
    return CAMPAIGN_TRANSITIONS[status];
  }
}
