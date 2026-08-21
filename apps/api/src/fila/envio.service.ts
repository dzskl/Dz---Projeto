import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createLogger, decryptSecret, getEnv } from '@tg/config';
import { prisma } from '@tg/database';
import type { BotaoInput } from '@tg/shared';
import { Worker, type ConnectionOptions, type Job } from 'bullmq';
import {
  ErroTelegram,
  TELEGRAM_API_FACTORY,
  type TelegramApi,
  type TelegramApiFactory,
} from '../telegram/telegram.types';
import { nomeDaFila, obterConexao, type JobDeEnvio } from './fila';

const logger = createLogger('envio');

/**
 * Execucao dos envios.
 *
 * Um worker por bot, cada um com o limite de velocidade daquele bot. O que este
 * servico resolve nao e "mandar mensagem" — e decidir o que fazer quando o envio
 * falha, porque cada tipo de falha pede uma reacao diferente:
 *
 * | Falha                        | Reacao                                      |
 * |------------------------------|---------------------------------------------|
 * | 429 (excedeu a cota)         | esperar o retry_after e tentar de novo       |
 * | 403 (bloqueou / conta morta) | marcar o contato e NUNCA repetir             |
 * | rede / 5xx                   | tentar de novo com espera crescente          |
 * | campanha nao esta rodando    | descartar sem enviar                         |
 *
 * Insistir num 403 nunca funciona e ainda gasta cota que outra pessoa poderia
 * usar; por isso ele e tratado como resultado final, e nao como erro.
 */

@Injectable()
export class EnvioService implements OnModuleInit, OnModuleDestroy {
  private readonly workers = new Map<string, Worker<JobDeEnvio>>();

  constructor(
    @Inject(TELEGRAM_API_FACTORY) private readonly telegram: TelegramApiFactory,
  ) {}

  /**
   * Retoma o consumo ao subir.
   *
   * Os workers vivem na memoria do processo; um reinicio os perde enquanto os
   * jobs continuam no Redis. Sem isto, uma campanha interrompida por deploy ou
   * queda ficaria parada em RUNNING para sempre, com a fila cheia e ninguem
   * consumindo.
   */
  async onModuleInit(): Promise<void> {
    // Em teste os workers sao criados pelos proprios casos, para controlar o
    // momento do consumo.
    if (process.env.NODE_ENV === 'test') return;
    const retomados = await this.iniciarWorkersAtivos();
    if (retomados > 0) logger.info({ bots: retomados }, 'workers retomados no boot');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    this.workers.clear();
  }

  /**
   * Garante um worker para o bot.
   *
   * `limiter` restringe o worker a `ratePerSecond` jobs por segundo; e o que
   * mantem o bot dentro da cota do Telegram. `concurrency` acima do limite nao
   * ajudaria — o limitador seguraria assim mesmo.
   */
  garantirWorker(botId: string, ratePerSecond: number): Worker<JobDeEnvio> {
    const existente = this.workers.get(botId);
    if (existente) return existente;

    const worker = new Worker<JobDeEnvio>(
      nomeDaFila(botId),
      async (job) => this.processar(job),
      {
        connection: obterConexao() as ConnectionOptions,
        limiter: { max: ratePerSecond, duration: 1_000 },
        concurrency: Math.min(ratePerSecond, 10),
      },
    );

    worker.on('failed', (job, err) => {
      logger.warn(
        { jobId: job?.id, tentativa: job?.attemptsMade, err: err.message },
        'envio falhou',
      );
    });

    this.workers.set(botId, worker);
    return worker;
  }

  /**
   * Sobe o worker ao iniciar ou retomar uma campanha.
   *
   * Inerte em teste: la os casos criam o worker no momento que escolhem, com
   * `garantirWorker`. Se subisse sozinho, um worker real competiria com o
   * processamento controlado dos testes e o resultado dependeria de quem
   * chegasse primeiro.
   */
  garantirWorkerAutomatico(botId: string, ratePerSecond: number): void {
    if (process.env.NODE_ENV === 'test') return;
    this.garantirWorker(botId, ratePerSecond);
  }

  /** Sobe workers para todos os bots com campanha em execucao. */
  async iniciarWorkersAtivos(): Promise<number> {
    const bots = await prisma.bot.findMany({
      where: { isActive: true, campaigns: { some: { status: 'RUNNING' } } },
      select: { id: true, ratePerSecond: true },
    });
    for (const bot of bots) this.garantirWorker(bot.id, bot.ratePerSecond);
    return bots.length;
  }

  /** Executa um job de envio. */
  private async processar(job: Job<JobDeEnvio>): Promise<void> {
    const { campanhaId, destinatarioId } = job.data;
    const inicio = Date.now();

    const destinatario = await prisma.campaignRecipient.findUnique({
      where: { id: destinatarioId },
      include: {
        botUser: { include: { telegramUser: true } },
        campaign: { include: { messages: true, bot: true } },
      },
    });

    // Destinatario sumiu (campanha excluida): nada a fazer.
    if (!destinatario) return;

    // Ja enviado: reentrega do BullMQ apos uma queda. Sair sem reenviar.
    if (destinatario.status === 'SENT') return;

    // A campanha pode ter sido pausada ou cancelada depois de o job entrar na
    // fila; o estado no banco manda, nao o job.
    if (destinatario.campaign.status !== 'RUNNING') {
      logger.debug({ campanhaId }, 'job descartado: campanha nao esta em execucao');
      return;
    }

    const chatId = destinatario.botUser.privateChatId;
    if (!chatId) {
      await this.registrarFalhaFinal(destinatarioId, campanhaId, 'sem_chat_privado', 'SKIPPED');
      return;
    }

    /**
     * Opt-out verificado no momento do envio.
     *
     * Alguem pode ter mandado /stop depois que a lista foi materializada. A
     * lista congelada garante contagem estavel, mas nao pode furar um pedido de
     * saida feito no meio do disparo.
     */
    const saiu = await prisma.optOut.findFirst({
      where: {
        telegramUserId: destinatario.botUser.telegramUserId,
        OR: [{ botId: destinatario.campaign.botId }, { botId: null }],
      },
      select: { id: true },
    });
    if (saiu) {
      await this.registrarFalhaFinal(destinatarioId, campanhaId, 'opt_out', 'SKIPPED');
      return;
    }

    const api = this.telegram.create(decryptSecret(destinatario.campaign.bot.tokenEncrypted));
    const mensagens = [...destinatario.campaign.messages].sort((a, b) => a.order - b.order);

    try {
      let ultimoId = 0;
      for (const mensagem of mensagens) {
        // Fase 4 envia texto; midia entra junto com a Central de Midia.
        const texto = mensagem.text ?? mensagem.caption ?? '';
        if (!texto) continue;
        const botoes = (mensagem.buttons as BotaoInput[] | null) ?? undefined;
        ultimoId = await api.sendMessage(chatId, texto, botoes);
      }

      await prisma.$transaction([
        prisma.campaignRecipient.update({
          where: { id: destinatarioId },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            attempts: { increment: 1 },
            telegramMessageId: BigInt(ultimoId),
          },
        }),
        prisma.campaign.update({
          where: { id: campanhaId },
          data: { sentCount: { increment: 1 } },
        }),
        prisma.sendLog.create({
          data: {
            campaignId: campanhaId,
            recipientId: destinatarioId,
            botId: destinatario.campaign.botId,
            attempt: job.attemptsMade + 1,
            success: true,
            durationMs: Date.now() - inicio,
          },
        }),
      ]);

      await this.concluirSeTerminou(campanhaId);
    } catch (err) {
      await this.tratarFalha(err, job, destinatario.campaign.botId, inicio);
    }
  }

  /**
   * Decide o destino de uma falha.
   *
   * Relancar faz o BullMQ tentar de novo conforme a politica de tentativas; nao
   * relancar encerra o job como concluido, que e o certo quando repetir nao tem
   * chance de funcionar.
   */
  private async tratarFalha(
    err: unknown,
    job: Job<JobDeEnvio>,
    botId: string,
    inicio: number,
  ): Promise<void> {
    const { campanhaId, destinatarioId } = job.data;
    const telegram = err instanceof ErroTelegram ? err : null;
    const descricao = err instanceof Error ? err.message : 'erro desconhecido';
    const tentativa = job.attemptsMade + 1;

    await prisma.sendLog.create({
      data: {
        campaignId: campanhaId,
        recipientId: destinatarioId,
        botId,
        attempt: tentativa,
        success: false,
        httpStatus: telegram?.statusCode ?? null,
        errorDescription: descricao,
        durationMs: Date.now() - inicio,
      },
    });

    // Destinatario inalcancavel: resultado final, nao erro.
    if (telegram?.destinatarioIndisponivel) {
      await this.marcarBloqueado(destinatarioId, campanhaId, botId, descricao);
      return;
    }

    const ultimaTentativa = tentativa >= getEnv().TELEGRAM_MAX_SEND_ATTEMPTS;
    if (ultimaTentativa) {
      await this.registrarFalhaFinal(destinatarioId, campanhaId, descricao, 'FAILED');
      return;
    }

    await prisma.campaignRecipient.update({
      where: { id: destinatarioId },
      data: { attempts: tentativa, lastErrorMessage: descricao },
    });

    // Relancar: o BullMQ aplica o backoff e tenta de novo.
    throw err;
  }

  /** Marca o contato como bloqueado, na campanha e na base. */
  private async marcarBloqueado(
    destinatarioId: string,
    campanhaId: string,
    botId: string,
    descricao: string,
  ): Promise<void> {
    const destinatario = await prisma.campaignRecipient.findUnique({
      where: { id: destinatarioId },
      select: { botUser: { select: { id: true, telegramUserId: true } } },
    });

    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: destinatarioId },
        data: {
          status: 'BLOCKED',
          failedAt: new Date(),
          lastErrorCode: '403',
          lastErrorMessage: descricao,
        },
      }),
      prisma.campaign.update({
        where: { id: campanhaId },
        data: { blockedCount: { increment: 1 } },
      }),
      // A descoberta vale para toda a base, nao so para esta campanha: sem isso,
      // a proxima campanha tentaria de novo e falharia igual.
      ...(destinatario
        ? [
            prisma.botUser.update({
              where: { id: destinatario.botUser.id },
              data: { status: 'BLOCKED_BOT', statusChangedAt: new Date() },
            }),
            prisma.optOut.upsert({
              where: {
                botId_telegramUserId: {
                  botId,
                  telegramUserId: destinatario.botUser.telegramUserId,
                },
              },
              create: {
                botId,
                telegramUserId: destinatario.botUser.telegramUserId,
                reason: 'BLOCKED_BOT',
              },
              update: {},
            }),
          ]
        : []),
    ]);

    await this.concluirSeTerminou(campanhaId);
  }

  private async registrarFalhaFinal(
    destinatarioId: string,
    campanhaId: string,
    descricao: string,
    status: 'FAILED' | 'SKIPPED',
  ): Promise<void> {
    await prisma.$transaction([
      prisma.campaignRecipient.update({
        where: { id: destinatarioId },
        data: { status, failedAt: new Date(), lastErrorMessage: descricao },
      }),
      prisma.campaign.update({
        where: { id: campanhaId },
        data:
          status === 'FAILED'
            ? { failedCount: { increment: 1 } }
            : { skippedCount: { increment: 1 } },
      }),
    ]);
    await this.concluirSeTerminou(campanhaId);
  }

  /**
   * Fecha a campanha quando nao resta ninguem pendente.
   *
   * A checagem e por contagem no banco, e nao por contador em memoria: com
   * varios workers, so o banco sabe o estado real.
   */
  private async concluirSeTerminou(campanhaId: string): Promise<void> {
    const restantes = await prisma.campaignRecipient.count({
      where: { campaignId: campanhaId, status: { in: ['PENDING', 'QUEUED'] } },
    });
    if (restantes > 0) return;

    // updateMany com filtro de status: se dois workers terminarem ao mesmo
    // tempo, apenas um consegue mudar de RUNNING para COMPLETED.
    const { count } = await prisma.campaign.updateMany({
      where: { id: campanhaId, status: 'RUNNING' },
      data: { status: 'COMPLETED', finishedAt: new Date() },
    });
    if (count > 0) logger.info({ campanhaId }, 'campanha concluida');
  }

  /** Executa um job sem passar pela fila. Usado nos testes. */
  async processarDireto(job: Job<JobDeEnvio>): Promise<void> {
    return this.processar(job);
  }
}

export type { TelegramApi };
