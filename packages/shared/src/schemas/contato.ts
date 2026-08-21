import { z } from 'zod';
import { BotUserStatus, ConsentSource, OptOutReason } from '../enums.js';

/**
 * Schemas de contatos.
 *
 * "Contato" aqui e sempre o par (pessoa, bot): a mesma pessoa pode estar ativa
 * num bot e ter bloqueado outro, e cada bot tem a sua propria base.
 */

export const listarContatosSchema = z.object({
  botId: z.string().uuid().optional(),
  status: z.nativeEnum(BotUserStatus).optional(),
  /** Busca por nome ou @username. */
  busca: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  /** Teto de 100 para uma pagina nao conseguir derrubar o painel. */
  porPagina: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListarContatosInput = z.infer<typeof listarContatosSchema>;

export const criarOptOutSchema = z.object({
  telegramUserId: z.string().uuid(),
  /** Nulo aplica o opt-out a todos os bots. */
  botId: z.string().uuid().nullable().default(null),
  motivo: z.string().trim().min(3, 'Explique o motivo.').max(300),
});
export type CriarOptOutInput = z.infer<typeof criarOptOutSchema>;

export interface ContatoPublico {
  id: string;
  telegramUserId: string;
  nome: string;
  username: string | null;
  status: BotUserStatus;
  origemConsentimento: ConsentSource;
  consentimentoEm: string;
  origemCampanha: string | null;
  ultimaInteracaoEm: string | null;
  podeReceber: boolean;
  bot: { id: string; username: string };
}

export interface OptOutPublico {
  id: string;
  telegramUserId: string;
  nome: string;
  username: string | null;
  botId: string | null;
  botUsername: string | null;
  motivo: OptOutReason;
  observacao: string | null;
  criadoEm: string;
}

export interface PaginaDeContatos {
  contatos: ContatoPublico[];
  total: number;
  pagina: number;
  porPagina: number;
  /** Quantos podem receber campanha agora. */
  totalElegiveis: number;
}
