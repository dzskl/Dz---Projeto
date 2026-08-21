import { Inject, Injectable } from '@nestjs/common';
import {
  createLogger,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  getEnv,
  secretHint,
} from '@tg/config';
import { prisma, type Bot } from '@tg/database';
import {
  AuditAction,
  ConflictError,
  DomainError,
  ErrorCode,
  NotFoundError,
  type AtualizarBotInput,
  type BotPublico,
  type CriarBotInput,
} from '@tg/shared';
import { AuditService } from '../audit/audit.service';
import type { RequestContext } from '../auth/auth.service';
import {
  ErroTelegram,
  TELEGRAM_API_FACTORY,
  type TelegramApiFactory,
} from '../telegram/telegram.types';

const logger = createLogger('bots');

@Injectable()
export class BotsService {
  constructor(
    @Inject(TELEGRAM_API_FACTORY) private readonly telegram: TelegramApiFactory,
    private readonly audit: AuditService,
  ) {}

  /** Converte o registro do banco no formato publico. Nunca expoe o token. */
  static toPublic(bot: Bot, extras?: { totalContatos?: number; totalGrupos?: number }): BotPublico {
    return {
      id: bot.id,
      // BigInt nao sobrevive a JSON.stringify; string preserva a precisao.
      telegramBotId: bot.telegramBotId.toString(),
      username: bot.username,
      name: bot.name,
      tokenHint: bot.tokenHint,
      status: bot.status,
      isActive: bot.isActive,
      ratePerSecond: bot.ratePerSecond,
      lastCheckAt: bot.lastCheckAt?.toISOString() ?? null,
      lastErrorAt: bot.lastErrorAt?.toISOString() ?? null,
      lastError: bot.lastError,
      createdAt: bot.createdAt.toISOString(),
      ...extras,
    };
  }

  /** Endereco que o Telegram chamara para entregar os updates deste bot. */
  private urlDoWebhook(botId: string): string {
    return `${getEnv().API_PUBLIC_URL}/api/telegram/webhook/${botId}`;
  }

  /**
   * Cadastra um bot.
   *
   * A ordem importa: valida o token no Telegram antes de gravar qualquer coisa,
   * para nao deixar registro invalido no banco. O webhook so e registrado depois
   * do insert, porque a URL depende do id gerado.
   *
   * Se o registro do webhook falhar, o bot permanece salvo com status ERROR em
   * vez de ser desfeito: o token ja foi validado e o administrador pode tentar
   * reconectar sem recadastrar.
   */
  async criar(input: CriarBotInput, actorId: string, ctx: RequestContext): Promise<BotPublico> {
    const api = this.telegram.create(input.token);

    // 1. Validar o token.
    let dados;
    try {
      dados = await api.getMe();
    } catch (err) {
      if (err instanceof ErroTelegram && err.tokenInvalido) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          'O Telegram recusou este token. Confira o valor no BotFather.',
          { fields: { token: ['Token recusado pelo Telegram.'] } },
        );
      }
      throw new DomainError(
        ErrorCode.INTERNAL,
        'Nao foi possivel falar com o Telegram agora. Tente novamente.',
      );
    }

    // 2. Um mesmo bot nao pode ser cadastrado duas vezes.
    const existente = await prisma.bot.findUnique({
      where: { telegramBotId: BigInt(dados.id) },
    });
    if (existente) {
      throw new ConflictError(`O bot @${dados.username} ja esta cadastrado.`);
    }

    // 3. Gravar com o token cifrado.
    const webhookSecret = generateWebhookSecret();
    const bot = await prisma.bot.create({
      data: {
        telegramBotId: BigInt(dados.id),
        username: dados.username,
        name: input.apelido ?? dados.firstName,
        tokenEncrypted: encryptSecret(input.token),
        tokenHint: secretHint(input.token),
        webhookSecret,
        ratePerSecond: input.ratePerSecond,
        status: 'CONNECTED',
        lastCheckAt: new Date(),
      },
    });

    // 4. Registrar o webhook.
    let registrado = bot;
    try {
      await api.setWebhook(this.urlDoWebhook(bot.id), webhookSecret);
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Falha ao registrar o webhook.';
      logger.error({ err, botId: bot.id }, 'falha ao registrar webhook');
      registrado = await prisma.bot.update({
        where: { id: bot.id },
        data: { status: 'ERROR', lastError: mensagem, lastErrorAt: new Date() },
      });
    }

    await this.audit.record({
      action: AuditAction.BOT_CREATED,
      adminId: actorId,
      entityType: 'Bot',
      entityId: bot.id,
      metadata: { username: dados.username, telegramBotId: dados.id.toString() },
      ...ctx,
    });

    return BotsService.toPublic(registrado);
  }

  async listar(): Promise<BotPublico[]> {
    const bots = await prisma.bot.findMany({ orderBy: { createdAt: 'desc' } });

    // Contagens em duas consultas agregadas, e nao uma por bot: com varios bots
    // o padrao "uma consulta por item" degrada rapido.
    const [contatos, grupos] = await Promise.all([
      prisma.botUser.groupBy({
        by: ['botId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      prisma.chat.groupBy({
        by: ['botId'],
        where: { type: { in: ['GROUP', 'SUPERGROUP', 'CHANNEL'] } },
        _count: { _all: true },
      }),
    ]);

    const porContatos = new Map(contatos.map((c) => [c.botId, c._count._all]));
    const porGrupos = new Map(grupos.map((g) => [g.botId, g._count._all]));

    return bots.map((bot) =>
      BotsService.toPublic(bot, {
        totalContatos: porContatos.get(bot.id) ?? 0,
        totalGrupos: porGrupos.get(bot.id) ?? 0,
      }),
    );
  }

  async buscar(id: string): Promise<BotPublico> {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundError('Bot');
    return BotsService.toPublic(bot);
  }

  async atualizar(
    id: string,
    input: AtualizarBotInput,
    actorId: string,
    ctx: RequestContext,
  ): Promise<BotPublico> {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundError('Bot');

    const atualizado = await prisma.bot.update({
      where: { id },
      data: {
        ...(input.apelido !== undefined ? { name: input.apelido } : {}),
        ...(input.ratePerSecond !== undefined ? { ratePerSecond: input.ratePerSecond } : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive, status: input.isActive ? bot.status : 'DISABLED' }
          : {}),
      },
    });

    // Desativar precisa remover o webhook: sem isso o Telegram continuaria
    // entregando updates de um bot que o painel considera desligado.
    if (input.isActive === false) {
      await this.removerWebhook(bot).catch((err: unknown) => {
        logger.warn({ err, botId: id }, 'falha ao remover webhook ao desativar');
      });
    }
    if (input.isActive === true) {
      await this.reconectar(id, actorId, ctx).catch((err: unknown) => {
        logger.warn({ err, botId: id }, 'falha ao reconectar webhook ao ativar');
      });
    }

    await this.audit.record({
      action: AuditAction.BOT_UPDATED,
      adminId: actorId,
      entityType: 'Bot',
      entityId: id,
      metadata: { ...input },
      ...ctx,
    });

    return BotsService.toPublic(atualizado);
  }

  /**
   * Revalida o token e registra o webhook de novo.
   *
   * Util quando o token foi revogado e recriado, ou quando o registro falhou no
   * cadastro.
   */
  async reconectar(id: string, actorId: string, ctx: RequestContext): Promise<BotPublico> {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundError('Bot');

    const api = this.telegram.create(decryptSecret(bot.tokenEncrypted));

    try {
      const dados = await api.getMe();
      await api.setWebhook(this.urlDoWebhook(bot.id), bot.webhookSecret);

      const atualizado = await prisma.bot.update({
        where: { id },
        data: {
          username: dados.username,
          status: 'CONNECTED',
          lastCheckAt: new Date(),
          lastError: null,
          lastErrorAt: null,
        },
      });
      return BotsService.toPublic(atualizado);
    } catch (err) {
      const invalido = err instanceof ErroTelegram && err.tokenInvalido;
      const mensagem = err instanceof Error ? err.message : 'Falha ao reconectar.';

      const atualizado = await prisma.bot.update({
        where: { id },
        data: {
          status: invalido ? 'INVALID_TOKEN' : 'ERROR',
          lastError: mensagem,
          lastErrorAt: new Date(),
          lastCheckAt: new Date(),
        },
      });

      await this.audit.record({
        action: AuditAction.BOT_UPDATED,
        adminId: actorId,
        entityType: 'Bot',
        entityId: id,
        metadata: { reconectar: 'falhou', erro: mensagem },
        ...ctx,
      });

      return BotsService.toPublic(atualizado);
    }
  }

  private async removerWebhook(bot: Bot): Promise<void> {
    const api = this.telegram.create(decryptSecret(bot.tokenEncrypted));
    await api.deleteWebhook();
  }

  /**
   * Exclui um bot.
   *
   * Remove o webhook antes de apagar: se o registro sumisse primeiro, o Telegram
   * continuaria chamando uma URL que nao existe mais. A falha ao remover nao
   * impede a exclusao — o token pode ja ter sido revogado.
   */
  async excluir(id: string, actorId: string, ctx: RequestContext): Promise<void> {
    const bot = await prisma.bot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundError('Bot');

    const campanhas = await prisma.campaign.count({
      where: { botId: id, status: { in: ['RUNNING', 'PAUSED', 'SCHEDULED'] } },
    });
    if (campanhas > 0) {
      throw new ConflictError(
        'Este bot tem campanhas em andamento. Cancele-as antes de excluir.',
      );
    }

    await this.removerWebhook(bot).catch((err: unknown) => {
      logger.warn({ err, botId: id }, 'falha ao remover webhook na exclusao');
    });

    await prisma.bot.delete({ where: { id } });

    await this.audit.record({
      action: AuditAction.BOT_DELETED,
      adminId: actorId,
      entityType: 'Bot',
      entityId: id,
      metadata: { username: bot.username },
      ...ctx,
    });
  }
}
