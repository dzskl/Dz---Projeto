import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createLogger } from '@tg/config';
import { prisma } from '@tg/database';
import { UpdateProcessorService } from './update-processor.service';

const logger = createLogger('updates');

/**
 * Agendamento do processamento de updates.
 *
 * O webhook nao processa nada dentro da requisicao: ele grava e responde 200,
 * porque o Telegram serializa as entregas por bot e reenvia se a resposta
 * demorar. O trabalho fica para depois.
 *
 * A fonte da verdade e a coluna `processed_at` na tabela de updates, nao a
 * memoria deste processo. Por isso existem dois caminhos:
 *
 * - **Imediato**: apos gravar, o webhook pede o processamento fora do ciclo da
 *   requisicao. E o caminho rapido, do dia a dia.
 * - **Varredura**: periodicamente busca updates nao processados. Cobre o que o
 *   caminho imediato perdeu — reinicio do processo, falha transitoria, erro que
 *   deixou `processed_at` nulo.
 *
 * Sem a varredura, uma queda no momento errado perderia consentimento em
 * silencio.
 */

/** Intervalo entre varreduras. */
const INTERVALO_VARREDURA_MS = 30_000;

/** Quantos updates uma varredura processa por vez. */
const LOTE = 50;

/**
 * Carencia antes de a varredura pegar um update.
 *
 * Evita competir com o processamento imediato que provavelmente ja esta em
 * andamento para os updates recem-gravados.
 */
const CARENCIA_MS = 10_000;

@Injectable()
export class UpdatesService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  /** Impede duas varreduras simultaneas no mesmo processo. */
  private varrendo = false;

  constructor(private readonly processador: UpdateProcessorService) {}

  onModuleInit(): void {
    // Em teste a varredura periodica atrapalharia: os casos chamam o
    // processamento diretamente e esperam controle total do momento.
    if (process.env.NODE_ENV === 'test') return;

    this.timer = setInterval(() => {
      void this.varrer();
    }, INTERVALO_VARREDURA_MS);
    // unref: o timer nao pode impedir o processo de encerrar.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Pede o processamento de um update fora do ciclo da requisicao.
   *
   * Deliberadamente nao aguardado por quem chama: o webhook precisa responder
   * imediatamente. Se falhar, a varredura tenta de novo.
   */
  agendar(updateId: string): void {
    setImmediate(() => {
      void this.processarPorId(updateId);
    });
  }

  private async processarPorId(updateId: string): Promise<void> {
    const registro = await prisma.telegramUpdate.findUnique({ where: { id: updateId } });
    if (!registro || registro.processedAt) return;
    await this.processador.processar(registro).catch(() => {
      // Ja registrado no log e no campo `error`; a varredura repete.
    });
  }

  /** Processa updates pendentes. Devolve quantos foram tratados. */
  async varrer(): Promise<number> {
    if (this.varrendo) return 0;
    this.varrendo = true;

    try {
      const pendentes = await prisma.telegramUpdate.findMany({
        where: {
          processedAt: null,
          createdAt: { lt: new Date(Date.now() - CARENCIA_MS) },
        },
        orderBy: { createdAt: 'asc' },
        take: LOTE,
      });

      let tratados = 0;
      for (const registro of pendentes) {
        try {
          await this.processador.processar(registro);
          tratados += 1;
        } catch {
          // O erro ja foi gravado no registro; seguir para o proximo em vez de
          // travar a fila inteira num update problematico.
        }
      }

      if (tratados > 0) logger.info({ tratados }, 'updates processados pela varredura');
      return tratados;
    } finally {
      this.varrendo = false;
    }
  }
}
