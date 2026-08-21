/**
 * Contrato de acesso a Bot API do Telegram.
 *
 * A API real e isolada atras desta interface por dois motivos: os testes rodam
 * sem rede e sem token valido, e trocar a biblioteca (hoje grammY) nao obriga a
 * mexer na regra de negocio.
 */

/** Resposta de getMe, com apenas os campos que o cadastro usa. */
export interface DadosDoBot {
  id: number;
  username: string;
  firstName: string;
  isBot: boolean;
  canJoinGroups: boolean;
  canReadAllGroupMessages: boolean;
}

/** Situacao do webhook, para diagnostico no painel. */
export interface InfoWebhook {
  url: string;
  pendingUpdateCount: number;
  lastErrorDate?: number;
  lastErrorMessage?: string;
}

/** Botao inline, no formato que o envio precisa. */
export interface BotaoInline {
  texto: string;
  url?: string;
  callbackData?: string;
}

export interface TelegramApi {
  /** Valida o token e devolve a identidade do bot. */
  getMe(): Promise<DadosDoBot>;
  /**
   * Envia uma mensagem de texto.
   *
   * Devolve o id da mensagem. Lanca ErroTelegram com `destinatarioIndisponivel`
   * quando a pessoa bloqueou o bot ou desativou a conta.
   */
  sendMessage(chatId: number | bigint, texto: string, botoes?: BotaoInline[]): Promise<number>;
  /** Registra o endereco que recebera os updates. */
  setWebhook(url: string, secretToken: string): Promise<void>;
  /** Remove o webhook (usado ao desativar ou excluir o bot). */
  deleteWebhook(): Promise<void>;
  getWebhookInfo(): Promise<InfoWebhook>;
}

/** Cria um cliente para um token. Injetavel, para os testes substituirem. */
export interface TelegramApiFactory {
  create(token: string): TelegramApi;
}

/** Token de injecao do NestJS (a interface some em tempo de execucao). */
export const TELEGRAM_API_FACTORY = Symbol('TELEGRAM_API_FACTORY');

/**
 * Erro vindo do Telegram, ja classificado.
 *
 * `tokenInvalido` separa "esse token nao serve" (erro do usuario, definitivo) de
 * "o Telegram esta fora do ar" (transitorio, vale tentar de novo) — a decisao de
 * marcar o bot como INVALID_TOKEN depende disso.
 */
export class ErroTelegram extends Error {
  constructor(
    message: string,
    readonly statusCode: number | undefined,
    readonly tokenInvalido: boolean,
    /**
     * A pessoa bloqueou o bot, apagou a conta ou o chat sumiu.
     *
     * Separado de tokenInvalido porque a consequencia e outra: nao ha nada de
     * errado com o bot, apenas aquele destinatario deixou de ser alcancavel.
     */
    readonly destinatarioIndisponivel = false,
  ) {
    super(message);
    this.name = 'ErroTelegram';
  }
}
