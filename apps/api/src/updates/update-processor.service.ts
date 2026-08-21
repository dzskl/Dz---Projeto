import { Inject, Injectable } from '@nestjs/common';
import { createLogger, decryptSecret } from '@tg/config';
import { Prisma, prisma, type TelegramUpdate } from '@tg/database';
import type { BotUserStatus, ConsentSource } from '@tg/shared';
import { TELEGRAM_API_FACTORY, type TelegramApiFactory } from '../telegram/telegram.types';

const logger = createLogger('processador');

/**
 * Aplica o efeito de um update do Telegram.
 *
 * Este e o servico que transforma "chegou uma mensagem" em consentimento,
 * opt-out ou presenca em grupo. Duas regras guiam tudo aqui:
 *
 * 1. **Idempotencia.** Reprocessar um update precisa dar o mesmo resultado. Todas
 *    as escritas usam upsert ou sao condicionais — nunca "incrementa" nem
 *    "adiciona". Se o processo cair no meio, a varredura repete sem estragar.
 *
 * 2. **Consentimento so aumenta com ato do usuario.** Um /start cria ou reativa;
 *    uma mensagem qualquer nao promove quem ja pediu para sair.
 */

/** Texto de confirmacao do /start. */
const RESPOSTA_START =
  'Pronto! Voce vai receber nossas novidades por aqui.\n\n' +
  'Se quiser parar a qualquer momento, envie /stop.';

/** Texto de confirmacao do /stop. */
const RESPOSTA_STOP =
  'Tudo certo, voce nao vai mais receber mensagens nossas.\n\n' +
  'Se mudar de ideia, envie /start.';

/** Formato minimo de um usuario do Telegram dentro do update. */
interface UsuarioTelegram {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface ChatTelegram {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

/** Traduz o tipo de chat do Telegram para o enum do banco. */
function tipoChat(tipo: string): 'PRIVATE' | 'GROUP' | 'SUPERGROUP' | 'CHANNEL' | null {
  switch (tipo) {
    case 'private':
      return 'PRIVATE';
    case 'group':
      return 'GROUP';
    case 'supergroup':
      return 'SUPERGROUP';
    case 'channel':
      return 'CHANNEL';
    default:
      return null;
  }
}

/** Traduz o status do bot dentro de um chat. */
function statusNoChat(status: string): 'MEMBER' | 'ADMINISTRATOR' | 'LEFT' | 'KICKED' | null {
  switch (status) {
    case 'member':
    case 'restricted':
      return 'MEMBER';
    case 'administrator':
    case 'creator':
      return 'ADMINISTRATOR';
    case 'left':
      return 'LEFT';
    case 'kicked':
      return 'KICKED';
    default:
      return null;
  }
}

@Injectable()
export class UpdateProcessorService {
  constructor(
    @Inject(TELEGRAM_API_FACTORY) private readonly telegram: TelegramApiFactory,
  ) {}

  /**
   * Processa um update ja gravado.
   *
   * Marca `processedAt` ao final. Em caso de erro, grava a mensagem em `error` e
   * deixa `processedAt` nulo, para a varredura tentar de novo.
   */
  async processar(registro: TelegramUpdate): Promise<void> {
    const payload = registro.payload as Record<string, unknown>;

    try {
      switch (registro.type) {
        case 'message':
          await this.tratarMensagem(registro.botId, payload.message as Record<string, unknown>);
          break;
        case 'callback_query':
          await this.tratarCallback(
            registro.botId,
            payload.callback_query as Record<string, unknown>,
          );
          break;
        case 'my_chat_member':
          await this.tratarMudancaDeStatus(
            registro.botId,
            payload.my_chat_member as Record<string, unknown>,
          );
          break;
        default:
          // Tipo que nao nos interessa (chat_member de terceiros, edicoes).
          // Marcar como processado evita a varredura tentar para sempre.
          break;
      }

      await prisma.telegramUpdate.update({
        where: { id: registro.id },
        data: { processedAt: new Date(), error: null },
      });
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'erro desconhecido';
      logger.error({ err, updateId: registro.id, tipo: registro.type }, 'falha ao processar update');
      await prisma.telegramUpdate.update({
        where: { id: registro.id },
        data: { error: mensagem },
      });
      throw err;
    }
  }

  /**
   * Garante a existencia da pessoa no banco.
   *
   * Os dados de perfil sao atualizados a cada interacao: nome e username mudam
   * no Telegram e a base precisa acompanhar.
   */
  private async upsertPessoa(usuario: UsuarioTelegram): Promise<string> {
    const dados = {
      firstName: usuario.first_name ?? null,
      lastName: usuario.last_name ?? null,
      username: usuario.username ?? null,
      languageCode: usuario.language_code ?? null,
      isBot: usuario.is_bot ?? false,
    };

    const pessoa = await prisma.telegramUser.upsert({
      where: { telegramUserId: BigInt(usuario.id) },
      create: { telegramUserId: BigInt(usuario.id), ...dados },
      update: dados,
    });
    return pessoa.id;
  }

  /**
   * Registra ou atualiza o vinculo entre a pessoa e o bot.
   *
   * `promoverParaAtivo` distingue os dois casos: um /start e ato explicito e
   * reativa quem havia saido; uma mensagem comum apenas atualiza a ultima
   * interacao, sem ressuscitar quem pediu para sair.
   */
  private async registrarVinculo(params: {
    botId: string;
    pessoaId: string;
    chatPrivadoId: bigint | null;
    origem: ConsentSource;
    payloadConsentimento?: string | null;
    promoverParaAtivo: boolean;
  }): Promise<void> {
    const agora = new Date();
    const existente = await prisma.botUser.findUnique({
      where: { botId_telegramUserId: { botId: params.botId, telegramUserId: params.pessoaId } },
    });

    if (!existente) {
      await prisma.botUser.create({
        data: {
          botId: params.botId,
          telegramUserId: params.pessoaId,
          privateChatId: params.chatPrivadoId,
          status: 'ACTIVE',
          consentSource: params.origem,
          consentAt: agora,
          consentPayload: params.payloadConsentimento ?? null,
          lastInteractionAt: agora,
        },
      });
      return;
    }

    const virandoAtivo = params.promoverParaAtivo && existente.status !== 'ACTIVE';

    await prisma.botUser.update({
      where: { id: existente.id },
      data: {
        lastInteractionAt: agora,
        // O chat privado so aparece quando a pessoa abre conversa; nao apagar o
        // que ja se sabe se este update nao trouxer.
        ...(params.chatPrivadoId ? { privateChatId: params.chatPrivadoId } : {}),
        ...(virandoAtivo
          ? {
              status: 'ACTIVE' as BotUserStatus,
              statusChangedAt: agora,
              // Novo consentimento explicito: registra a origem e a data.
              consentSource: params.origem,
              consentAt: agora,
              consentPayload: params.payloadConsentimento ?? existente.consentPayload,
            }
          : {}),
      },
    });
  }

  /** Marca a pessoa como fora da base, com o motivo. */
  private async registrarSaida(
    botId: string,
    pessoaId: string,
    status: Extract<BotUserStatus, 'BLOCKED_BOT' | 'DEACTIVATED' | 'UNSUBSCRIBED'>,
    motivo: 'USER_REQUEST' | 'BLOCKED_BOT' | 'DEACTIVATED',
  ): Promise<void> {
    const agora = new Date();

    await prisma.botUser.updateMany({
      where: { botId, telegramUserId: pessoaId },
      data: { status, statusChangedAt: agora },
    });

    // O opt-out e por bot: sair de um bot nao tira a pessoa dos outros.
    await prisma.optOut.upsert({
      where: { botId_telegramUserId: { botId, telegramUserId: pessoaId } },
      create: { botId, telegramUserId: pessoaId, reason: motivo },
      update: { reason: motivo },
    });
  }

  /** Envia uma confirmacao, sem deixar a falha derrubar o processamento. */
  private async responder(botId: string, chatId: bigint, texto: string): Promise<void> {
    try {
      const bot = await prisma.bot.findUnique({ where: { id: botId } });
      if (!bot) return;
      const api = this.telegram.create(decryptSecret(bot.tokenEncrypted));
      await api.sendMessage(chatId, texto);
    } catch (err) {
      // O dado ja foi gravado; nao conseguir confirmar e incomodo, nao um erro
      // que justifique reprocessar o update e arriscar efeito duplicado.
      logger.warn({ err, botId, chatId: chatId.toString() }, 'falha ao enviar confirmacao');
    }
  }

  private async tratarMensagem(
    botId: string,
    mensagem: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!mensagem) return;

    const chat = mensagem.chat as ChatTelegram | undefined;
    const de = mensagem.from as UsuarioTelegram | undefined;
    if (!chat) return;

    // Mensagem em grupo ou canal: interessa a presenca do bot, nao a pessoa.
    if (chat.type !== 'private') {
      await this.registrarChat(botId, chat, 'MEMBER');
      return;
    }

    if (!de || de.is_bot) return;

    const texto = typeof mensagem.text === 'string' ? mensagem.text.trim() : '';
    const pessoaId = await this.upsertPessoa(de);
    const chatId = BigInt(chat.id);

    if (texto.startsWith('/start')) {
      // Deep link: t.me/bot?start=<payload> chega como "/start <payload>" e
      // identifica de qual campanha ou canal a pessoa veio.
      const payload = texto.slice('/start'.length).trim() || null;

      await this.registrarVinculo({
        botId,
        pessoaId,
        chatPrivadoId: chatId,
        origem: 'START_COMMAND',
        payloadConsentimento: payload,
        promoverParaAtivo: true,
      });

      // /start e reconsentimento explicito: desfaz o opt-out daquele bot.
      await prisma.optOut.deleteMany({ where: { botId, telegramUserId: pessoaId } });

      await this.responder(botId, chatId, RESPOSTA_START);
      return;
    }

    if (texto.startsWith('/stop')) {
      await this.registrarSaida(botId, pessoaId, 'UNSUBSCRIBED', 'USER_REQUEST');
      await this.responder(botId, chatId, RESPOSTA_STOP);
      return;
    }

    // Mensagem comum no privado: vale como consentimento para quem ainda nao
    // esta na base, mas nao reativa quem pediu para sair.
    await this.registrarVinculo({
      botId,
      pessoaId,
      chatPrivadoId: chatId,
      origem: 'PRIVATE_MESSAGE',
      promoverParaAtivo: false,
    });
  }

  private async tratarCallback(
    botId: string,
    callback: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!callback) return;
    const de = callback.from as UsuarioTelegram | undefined;
    if (!de || de.is_bot) return;

    const mensagem = callback.message as Record<string, unknown> | undefined;
    const chat = mensagem?.chat as ChatTelegram | undefined;
    const chatPrivadoId = chat?.type === 'private' ? BigInt(chat.id) : null;

    const pessoaId = await this.upsertPessoa(de);
    await this.registrarVinculo({
      botId,
      pessoaId,
      chatPrivadoId,
      origem: 'CALLBACK_QUERY',
      promoverParaAtivo: false,
    });
  }

  /**
   * Trata my_chat_member: mudanca do status do proprio bot num chat.
   *
   * No privado, e assim que se descobre que alguem bloqueou o bot — o Telegram
   * avisa em vez de esperar a proxima falha de envio.
   */
  private async tratarMudancaDeStatus(
    botId: string,
    evento: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!evento) return;

    const chat = evento.chat as ChatTelegram | undefined;
    const novo = evento.new_chat_member as Record<string, unknown> | undefined;
    const status = typeof novo?.status === 'string' ? novo.status : null;
    if (!chat || !status) return;

    if (chat.type === 'private') {
      const de = evento.from as UsuarioTelegram | undefined;
      if (!de) return;
      const pessoaId = await this.upsertPessoa(de);

      if (status === 'kicked') {
        await this.registrarSaida(botId, pessoaId, 'BLOCKED_BOT', 'BLOCKED_BOT');
        return;
      }
      if (status === 'member') {
        // Desbloqueou: volta a ser alcancavel. Nao apaga o opt-out — se pediu
        // /stop antes, desbloquear nao significa querer receber de novo.
        await prisma.botUser.updateMany({
          where: { botId, telegramUserId: pessoaId, status: 'BLOCKED_BOT' },
          data: { status: 'ACTIVE', statusChangedAt: new Date() },
        });
      }
      return;
    }

    const statusBot = statusNoChat(status);
    if (statusBot) await this.registrarChat(botId, chat, statusBot);
  }

  /** Cria ou atualiza o registro de um grupo/canal onde o bot esta. */
  private async registrarChat(
    botId: string,
    chat: ChatTelegram,
    statusBot: 'MEMBER' | 'ADMINISTRATOR' | 'LEFT' | 'KICKED',
  ): Promise<void> {
    const tipo = tipoChat(chat.type);
    if (!tipo || tipo === 'PRIVATE') return;

    const dados = {
      type: tipo,
      title: chat.title ?? null,
      username: chat.username ?? null,
      botStatus: statusBot,
      lastSeenAt: new Date(),
    };

    await prisma.chat.upsert({
      where: {
        botId_telegramChatId: { botId, telegramChatId: BigInt(chat.id) },
      },
      create: { botId, telegramChatId: BigInt(chat.id), ...dados },
      update: dados,
    });
  }
}

/** Erro do Prisma para violacao de unicidade, exportado para os testes. */
export const UNIQUE_VIOLATION: Prisma.PrismaClientKnownRequestError['code'] = 'P2002';
