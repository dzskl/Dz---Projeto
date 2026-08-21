import { z } from 'zod';
import { BotStatus } from '../enums.js';

/**
 * Schemas de bot.
 *
 * O formato do token e validado antes de qualquer chamada de rede: recusar
 * localmente o que e obviamente invalido evita uma ida ao Telegram e devolve um
 * erro melhor ao usuario.
 */

/**
 * Token do BotFather: <id numerico>:<segredo>.
 *
 * O id tem entre 8 e 12 digitos e o segredo ao menos 30 caracteres do alfabeto
 * base64url. O formato e estavel ha anos, mas a validacao proposital nao exige
 * tamanho exato para nao quebrar se o Telegram alargar a faixa.
 */
export const botTokenSchema = z
  .string()
  .trim()
  .regex(/^\d{8,12}:[A-Za-z0-9_-]{30,}$/, 'Token invalido. Copie o valor exato do BotFather.');

export const criarBotSchema = z.object({
  token: botTokenSchema,
  /** Nome interno para a equipe distinguir os bots; nao e o nome no Telegram. */
  apelido: z.string().trim().min(2, 'Informe um apelido.').max(80).optional(),
  /** Mensagens por segundo. O Telegram corta perto de 30; o padrao deixa margem. */
  ratePerSecond: z.coerce.number().int().min(1).max(30).default(20),
});
export type CriarBotInput = z.infer<typeof criarBotSchema>;

export const atualizarBotSchema = z.object({
  apelido: z.string().trim().min(2).max(80).optional(),
  ratePerSecond: z.coerce.number().int().min(1).max(30).optional(),
  isActive: z.boolean().optional(),
});
export type AtualizarBotInput = z.infer<typeof atualizarBotSchema>;

/**
 * Bot como devolvido pela API.
 *
 * Nunca inclui o token, nem cifrado: apenas `tokenHint` (4 ultimos caracteres),
 * o suficiente para o administrador reconhecer qual token esta cadastrado.
 */
export interface BotPublico {
  id: string;
  telegramBotId: string;
  username: string;
  name: string;
  tokenHint: string;
  status: BotStatus;
  isActive: boolean;
  ratePerSecond: number;
  lastCheckAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  createdAt: string;
  /** Contadores para a listagem; calculados sob demanda. */
  totalContatos?: number;
  totalGrupos?: number;
}
