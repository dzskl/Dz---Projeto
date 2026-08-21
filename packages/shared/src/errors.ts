/**
 * Erros de dominio.
 *
 * A API converte estes erros em respostas HTTP num unico ponto (filtro global),
 * para que nenhuma camada precise conhecer codigos HTTP e nenhum detalhe interno
 * vaze para o cliente por acidente.
 */

export const ErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Erro de negocio cuja mensagem pode ser exibida ao usuario. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Faca login para continuar.') {
    super(ErrorCode.UNAUTHENTICATED, message);
  }
}

export class InvalidCredentialsError extends DomainError {
  constructor() {
    // Mensagem deliberadamente generica: nao revelar se o e-mail existe.
    super(ErrorCode.INVALID_CREDENTIALS, 'E-mail ou senha incorretos.');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Voce nao tem permissao para esta acao.') {
    super(ErrorCode.FORBIDDEN, message);
  }
}

export class NotFoundError extends DomainError {
  constructor(resource = 'Registro') {
    super(ErrorCode.NOT_FOUND, `${resource} nao encontrado.`);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(ErrorCode.CONFLICT, message);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Nao e possivel mudar de "${from}" para "${to}".`,
      { from, to },
    );
  }
}

/** Formato unico de erro devolvido pela API. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  };
}
