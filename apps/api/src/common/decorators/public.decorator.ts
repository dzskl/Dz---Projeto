import { SetMetadata } from '@nestjs/common';

/**
 * Marca uma rota como acessivel sem autenticacao.
 *
 * O guard de autenticacao e global: rotas sao protegidas por padrao e a exposicao
 * publica precisa ser declarada de forma explicita. Esquecer o decorator resulta
 * numa rota protegida, nao numa rota aberta.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
