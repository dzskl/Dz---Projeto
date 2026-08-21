import { Injectable } from '@nestjs/common';
import { Api, GrammyError, HttpError } from 'grammy';
import type {
  DadosDoBot,
  InfoWebhook,
  TelegramApi,
  TelegramApiFactory,
} from './telegram.types';
import { ErroTelegram } from './telegram.types';

/**
 * Implementacao real sobre o grammY.
 *
 * Concentra a traducao de erros: o resto do sistema so lida com ErroTelegram e
 * nao precisa conhecer as classes de erro da biblioteca.
 */

/**
 * Converte um erro do grammY em ErroTelegram.
 *
 * O Telegram responde 401 para token invalido e 404 quando o token nem existe —
 * ambos sao definitivos e nao adianta repetir. Falha de rede (HttpError) e
 * transitoria e nao deve marcar o bot como invalido.
 */
function traduzirErro(err: unknown): ErroTelegram {
  if (err instanceof GrammyError) {
    const definitivo = err.error_code === 401 || err.error_code === 404;
    return new ErroTelegram(
      definitivo ? 'Token recusado pelo Telegram.' : err.description,
      err.error_code,
      definitivo,
    );
  }
  if (err instanceof HttpError) {
    return new ErroTelegram('Nao foi possivel falar com o Telegram.', undefined, false);
  }
  return new ErroTelegram(
    err instanceof Error ? err.message : 'Erro desconhecido ao falar com o Telegram.',
    undefined,
    false,
  );
}

class GrammyTelegramApi implements TelegramApi {
  private readonly api: Api;

  constructor(token: string) {
    this.api = new Api(token);
  }

  async getMe(): Promise<DadosDoBot> {
    try {
      const me = await this.api.getMe();
      return {
        id: me.id,
        username: me.username,
        firstName: me.first_name,
        isBot: me.is_bot,
        canJoinGroups: me.can_join_groups ?? false,
        canReadAllGroupMessages: me.can_read_all_group_messages ?? false,
      };
    } catch (err) {
      throw traduzirErro(err);
    }
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    try {
      await this.api.setWebhook(url, {
        secret_token: secretToken,
        // Sem drop_pending_updates: updates acumulados enquanto o bot estava
        // fora devem ser processados, nao descartados.
        allowed_updates: ['message', 'callback_query', 'my_chat_member', 'chat_member'],
      });
    } catch (err) {
      throw traduzirErro(err);
    }
  }

  async deleteWebhook(): Promise<void> {
    try {
      await this.api.deleteWebhook();
    } catch (err) {
      throw traduzirErro(err);
    }
  }

  async getWebhookInfo(): Promise<InfoWebhook> {
    try {
      const info = await this.api.getWebhookInfo();
      return {
        // O Telegram omite a url quando nao ha webhook registrado.
        url: info.url ?? '',
        pendingUpdateCount: info.pending_update_count,
        lastErrorDate: info.last_error_date,
        lastErrorMessage: info.last_error_message,
      };
    } catch (err) {
      throw traduzirErro(err);
    }
  }
}

@Injectable()
export class GrammyApiFactory implements TelegramApiFactory {
  create(token: string): TelegramApi {
    return new GrammyTelegramApi(token);
  }
}
