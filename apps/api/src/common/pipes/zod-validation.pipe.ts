import { PipeTransform } from '@nestjs/common';
import { validate } from '@tg/shared';
import type { ZodSchema } from 'zod';

/**
 * Valida o corpo da requisicao com um schema Zod.
 *
 * A checagem propriamente dita fica em @tg/shared: o zod expoe pontos de entrada
 * distintos para CommonJS e ESM, e comparar `instanceof ZodError` atravessando a
 * fronteira dos pacotes falha silenciosamente. Os mesmos schemas sao usados pelo
 * painel, entao as regras existem num lugar so.
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return validate(this.schema, value);
  }
}
