import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Admin } from '@tg/database';
import type { AuthenticatedRequest } from '../guards/auth.guard';

/** Injeta o admin autenticado no handler. */
export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): Admin => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.admin;
});

/** Injeta o token de sessao bruto (necessario para o logout revogar a sessao). */
export const SessionToken = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.sessionToken;
});
