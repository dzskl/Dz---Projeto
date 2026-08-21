import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { createLogger, safeCompare } from '@tg/config';
import { Prisma, prisma } from '@tg/database';
import { Public } from '../common/decorators/public.decorator';

const logger = createLogger('webhook');

/** Cabecalho em que o Telegram devolve o secret_token registrado em setWebhook. */
const CABECALHO_SEGREDO = 'x-telegram-bot-api-secret-token';

/** Violacao de constraint unica no Prisma. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Recepcao de updates do Telegram.
 *
 * Tres decisoes definem este endpoint:
 *
 * 1. **Responder 200 rapido.** O Telegram considera a entrega falha se a resposta
 *    demorar e reenvia o update; pior, ele serializa as entregas por bot. Por
 *    isso aqui so gravamos o update e devolvemos — o processamento acontece
 *    depois, fora do ciclo da requisicao.
 *
 * 2. **Autenticar pelo secret_token.** A URL do webhook e publica; sem conferir o
 *    segredo, qualquer um poderia injetar updates falsos e criar consentimento
 *    de gente que nunca falou com o bot.
 *
 * 3. **Ser idempotente.** O Telegram reenvia quando nao recebe 200, e a rede
 *    pode duplicar. O unico (bot_id, update_id) faz o banco recusar a repeticao,
 *    e a repeticao e tratada como sucesso.
 */
@Controller('telegram')
export class WebhookController {
  @Public()
  @Post('webhook/:botId')
  @HttpCode(HttpStatus.OK)
  async receber(
    @Param('botId') botId: string,
    @Headers(CABECALHO_SEGREDO) segredoRecebido: string | undefined,
    @Body() update: Record<string, unknown>,
  ): Promise<{ ok: boolean }> {
    const bot = await prisma.bot.findUnique({
      where: { id: botId },
      select: { id: true, webhookSecret: true, isActive: true },
    });

    /**
     * Bot inexistente ou segredo errado.
     *
     * Devolve 200 de proposito. Um 401 faria o Telegram reenviar o mesmo update
     * indefinidamente, e a resposta ainda serviria de oraculo para alguem
     * descobrir quais ids de bot existem. Do ponto de vista de quem chama, o
     * resultado e indistinguivel de sucesso.
     */
    if (!bot || !segredoRecebido || !safeCompare(segredoRecebido, bot.webhookSecret)) {
      logger.warn({ botId, temSegredo: Boolean(segredoRecebido) }, 'webhook recusado');
      return { ok: true };
    }

    // Bot desativado: aceita e descarta, sem gravar.
    if (!bot.isActive) return { ok: true };

    const updateId = update.update_id;
    if (typeof updateId !== 'number') {
      logger.warn({ botId }, 'update sem update_id numerico');
      return { ok: true };
    }

    try {
      await prisma.telegramUpdate.create({
        data: {
          botId: bot.id,
          updateId: BigInt(updateId),
          type: tipoDoUpdate(update),
          payload: update as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION) {
        // Ja recebemos este update: reentrega do Telegram. Nada a fazer.
        return { ok: true };
      }
      // Falha real de gravacao: devolver erro faz o Telegram reenviar, que e o
      // comportamento desejado — o update nao pode ser perdido.
      logger.error({ err, botId, updateId }, 'falha ao gravar update');
      throw err;
    }

    return { ok: true };
  }
}

/**
 * Identifica o tipo do update.
 *
 * O Telegram entrega um objeto com update_id mais exatamente uma chave de
 * conteudo; o nome dessa chave e o tipo.
 */
function tipoDoUpdate(update: Record<string, unknown>): string {
  for (const chave of Object.keys(update)) {
    if (chave !== 'update_id') return chave;
  }
  return 'desconhecido';
}
