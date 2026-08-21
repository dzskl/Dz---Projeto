import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createLogger } from '@tg/config';
import { DomainError, ErrorCode, type ApiErrorBody } from '@tg/shared';
import type { Request, Response } from 'express';

const logger = createLogger('api');

/**
 * Traducao de erro de dominio para HTTP.
 *
 * Este e o unico ponto da API que conhece codigos HTTP: servicos lancam erros de
 * dominio e nao precisam saber se aquilo vira 401 ou 409.
 */
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  SESSION_EXPIRED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  CONFLICT: HttpStatus.CONFLICT,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

/**
 * Filtro global de excecoes.
 *
 * Garante que toda resposta de erro tenha o mesmo formato e que erro inesperado
 * nunca vaze stack trace nem mensagem interna para o cliente — o detalhe vai
 * para o log, com um correlationId que liga os dois.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = (request.headers['x-correlation-id'] as string | undefined) ?? undefined;

    if (exception instanceof DomainError) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.BAD_REQUEST;
      const body: ApiErrorBody = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          correlationId,
        },
      };
      // Erro de dominio e fluxo previsto (senha errada, conflito): nao e falha
      // do servidor, entao registra como aviso.
      logger.warn(
        { code: exception.code, path: request.url, method: request.method, correlationId },
        exception.message,
      );
      response.status(status).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ApiErrorBody = {
        error: {
          code: status === HttpStatus.NOT_FOUND ? ErrorCode.NOT_FOUND : ErrorCode.INTERNAL,
          message: exception.message,
          correlationId,
        },
      };
      response.status(status).json(body);
      return;
    }

    // Inesperado: o detalhe fica no log, o cliente recebe apenas a mensagem
    // generica.
    logger.error(
      { err: exception, path: request.url, method: request.method, correlationId },
      'erro nao tratado',
    );

    const body: ApiErrorBody = {
      error: {
        code: ErrorCode.INTERNAL,
        message: 'Erro interno. Tente novamente.',
        correlationId,
      },
    };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
