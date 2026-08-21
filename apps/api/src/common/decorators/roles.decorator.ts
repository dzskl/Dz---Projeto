import { SetMetadata } from '@nestjs/common';
import type { AdminRole } from '@tg/shared';

/** Restringe uma rota aos papeis informados. Sem o decorator, qualquer autenticado passa. */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: AdminRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);
