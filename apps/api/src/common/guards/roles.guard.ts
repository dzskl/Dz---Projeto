import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, type AdminRole } from '@tg/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Guard de papeis.
 *
 * Roda depois do AuthGuard, entao pode assumir que request.admin existe. Sem o
 * decorator @Roles, qualquer usuario autenticado passa.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const admin = request.admin;

    // Rota protegida sem admin significa ordem de guards incorreta: negar.
    if (!admin) throw new ForbiddenError();

    if (!required.includes(admin.role)) {
      throw new ForbiddenError('Seu perfil nao permite esta acao.');
    }
    return true;
  }
}
