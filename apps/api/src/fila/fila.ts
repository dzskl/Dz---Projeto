import { getEnv } from '@tg/config';
import { Queue, Worker, type ConnectionOptions, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

/**
 * Filas de envio.
 *
 * Existe **uma fila por bot**, e nao uma fila geral. O motivo e o limite do
 * Telegram: ele conta mensagens por segundo por bot, entao o controle de
 * velocidade precisa ser por bot tambem. Numa fila unica, um bot rapido
 * consumiria a cota de outro e os dois seriam limitados.
 *
 * Cada Worker recebe um `limiter` com a velocidade daquele bot. O BullMQ garante
 * que aquele worker nao processe mais do que `max` jobs por `duration`.
 */

/** Um job = uma mensagem para um destinatario. */
export interface JobDeEnvio {
  campanhaId: string;
  /** Linha de campaign_recipients; e a chave de idempotencia do envio. */
  destinatarioId: string;
  botId: string;
}

let conexao: IORedis | null = null;

/**
 * Conexao Redis compartilhada.
 *
 * `maxRetriesPerRequest: null` e exigido pelo BullMQ: com um limite, uma queda
 * momentanea do Redis faria os comandos falharem em vez de aguardarem a
 * reconexao, e jobs em andamento seriam perdidos.
 */
export function obterConexao(): IORedis {
  conexao ??= new IORedis(getEnv().REDIS_URL, { maxRetriesPerRequest: null });
  return conexao;
}

/**
 * Nome da fila do bot.
 *
 * Sem dois-pontos: o BullMQ reserva esse caractere para as suas proprias chaves
 * no Redis e recusa nomes que o contenham.
 */
export function nomeDaFila(botId: string): string {
  return `envio-${botId}`;
}

/**
 * Politica de tentativas.
 *
 * Backoff exponencial a partir de 5 segundos. Erros definitivos (bloqueio,
 * conta apagada) nao chegam a usar isto: o worker os trata como finais e nao
 * relanca, porque repetir nunca vai funcionar e so gasta cota do bot.
 */
export function opcoesDoJob(): JobsOptions {
  return {
    attempts: getEnv().TELEGRAM_MAX_SEND_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    // Manter todos os jobs concluidos estouraria a memoria do Redis numa
    // campanha grande; o historico real fica no banco (send_logs).
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  };
}

const filas = new Map<string, Queue<JobDeEnvio>>();

/** Fila do bot, criada sob demanda e reaproveitada. */
export function filaDoBot(botId: string): Queue<JobDeEnvio> {
  const nome = nomeDaFila(botId);
  let fila = filas.get(nome);
  if (!fila) {
    fila = new Queue<JobDeEnvio>(nome, { connection: obterConexao() as ConnectionOptions });
    filas.set(nome, fila);
  }
  return fila;
}

/** Fecha filas e conexao. Usado no encerramento e nos testes. */
export async function encerrarFilas(): Promise<void> {
  await Promise.all([...filas.values()].map((f) => f.close()));
  filas.clear();
  if (conexao) {
    await conexao.quit();
    conexao = null;
  }
}

export { Queue, Worker };
export type { ConnectionOptions };
