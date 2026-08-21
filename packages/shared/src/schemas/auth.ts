import { z } from 'zod';
import { AdminRole } from '../enums.js';

/**
 * Schemas de autenticacao.
 *
 * Usados pela API (validacao do request) e pelo front (validacao do formulario),
 * garantindo que as duas pontas concordem sobre o que e valido.
 */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Informe o e-mail.')
  .email('E-mail invalido.');

/**
 * Politica de senha.
 *
 * Comprimento minimo de 12 caracteres em vez de regras de complexidade: o
 * tamanho protege mais contra ataque de forca bruta do que exigir simbolos, e
 * incentiva frases-senha em vez de "Senha@123".
 */
export const passwordSchema = z
  .string()
  .min(12, 'A senha precisa ter pelo menos 12 caracteres.')
  .max(128, 'A senha pode ter no maximo 128 caracteres.');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Informe a senha.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createAdminSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  password: passwordSchema,
  role: z.nativeEnum(AdminRole).default(AdminRole.OWNER),
});
export type CreateAdminInput = z.infer<typeof createAdminSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Informe a senha atual.'),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'A nova senha precisa ser diferente da atual.',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** Admin como devolvido pela API — nunca inclui hash de senha. */
export interface AdminPublic {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}
