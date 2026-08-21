import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UnauthenticatedError } from '@tg/shared';
import type { Admin } from '@tg/database';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SESSION_COOKIE, SessionService } from '../../auth/session.service';

/** Request depois de autenticado. */
export interface AuthenticatedRequest extends Request {
  admin: Admin;
  sessionToken: string;
}

/**
 * Guard global de autenticacao.
 *
 * Aplicado a toda a aplicacao: uma rota nova nasce protegida. Para abrir uma
 * rota e preciso marca-la com @Public() de forma deliberada.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const cookies = request.cookies as Record<string, string> | undefined;
    const token = cookies?.[SESSION_COOKIE];

    if (!token) throw new UnauthenticatedError();

    const session = await this.sessions.validate(token);
    if (!session) throw new UnauthenticatedError('Sessao invalida ou expirada.');

    request.admin = session.admin;
    request.sessionToken = token;
    return true;
  }
}
