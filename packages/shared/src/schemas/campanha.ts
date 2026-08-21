import { z } from 'zod';
import { CampaignStatus, ConsentSource, MessageKind } from '../enums.js';

/**
 * Schemas de campanha.
 *
 * O limite de velocidade e a peca mais delicada: o Telegram corta perto de 30
 * mensagens por segundo por bot e, ultrapassado o teto com frequencia, o bot
 * pode ser limitado por horas. O maximo aceito aqui e 30, mas o padrao e 20 para
 * deixar margem.
 */

/** Botao inline. `url` abre um link; `callbackData` volta como callback_query. */
export const botaoSchema = z
  .object({
    texto: z.string().trim().min(1).max(64),
    url: z.string().url().optional(),
    callbackData: z.string().trim().max(64).optional(),
  })
  .refine((b) => Boolean(b.url) !== Boolean(b.callbackData), {
    message: 'Informe um link OU um dado de retorno, nao os dois.',
  });
export type BotaoInput = z.infer<typeof botaoSchema>;

/**
 * Uma parte da mensagem.
 *
 * O Telegram limita texto simples a 4096 caracteres e legenda de midia a 1024.
 * Validar aqui evita descobrir o problema so no meio do disparo.
 */
export const mensagemSchema = z
  .object({
    kind: z.nativeEnum(MessageKind).default(MessageKind.TEXT),
    texto: z.string().trim().max(4096).optional(),
    legenda: z.string().trim().max(1024).optional(),
    mediaAssetId: z.string().uuid().optional(),
    botoes: z.array(botaoSchema).max(8).optional(),
  })
  .refine((m) => (m.kind === MessageKind.TEXT ? Boolean(m.texto?.trim()) : true), {
    message: 'Mensagem de texto precisa ter conteudo.',
    path: ['texto'],
  })
  .refine((m) => (m.kind === MessageKind.TEXT ? true : Boolean(m.mediaAssetId)), {
    message: 'Mensagem com midia precisa de um arquivo.',
    path: ['mediaAssetId'],
  });
export type MensagemInput = z.infer<typeof mensagemSchema>;

/**
 * Filtro do publico.
 *
 * Aplicado sobre a base elegivel do bot, nunca fora dela: quem nao pode receber
 * continua nao podendo, independentemente do filtro.
 */
export const filtroPublicoSchema = z.object({
  /** So quem interagiu nos ultimos N dias. */
  interagiuNosUltimosDias: z.coerce.number().int().min(1).max(3650).optional(),
  /** So quem entrou por uma origem especifica. */
  origemConsentimento: z.nativeEnum(ConsentSource).optional(),
  /** So quem veio de um deep link especifico. */
  origemCampanha: z.string().trim().max(64).optional(),
});
export type FiltroPublicoInput = z.infer<typeof filtroPublicoSchema>;

export const criarCampanhaSchema = z.object({
  nome: z.string().trim().min(3, 'De um nome a campanha.').max(120),
  botId: z.string().uuid('Escolha um bot.'),
  mensagens: z.array(mensagemSchema).min(1, 'Adicione ao menos uma mensagem.').max(5),
  filtro: filtroPublicoSchema.optional(),
  ratePerSecond: z.coerce.number().int().min(1).max(30).default(20),
  /** ISO. Ausente significa envio imediato ao iniciar. */
  agendadaPara: z.string().datetime().optional(),
});
export type CriarCampanhaInput = z.infer<typeof criarCampanhaSchema>;

export const atualizarCampanhaSchema = z.object({
  nome: z.string().trim().min(3).max(120).optional(),
  mensagens: z.array(mensagemSchema).min(1).max(5).optional(),
  filtro: filtroPublicoSchema.nullable().optional(),
  ratePerSecond: z.coerce.number().int().min(1).max(30).optional(),
  agendadaPara: z.string().datetime().nullable().optional(),
});
export type AtualizarCampanhaInput = z.infer<typeof atualizarCampanhaSchema>;

export interface MensagemPublica {
  id: string;
  ordem: number;
  kind: MessageKind;
  texto: string | null;
  legenda: string | null;
  mediaAssetId: string | null;
  botoes: BotaoInput[] | null;
}

export interface CampanhaPublica {
  id: string;
  nome: string;
  status: CampaignStatus;
  bot: { id: string; username: string };
  mensagens: MensagemPublica[];
  filtro: FiltroPublicoInput | null;
  ratePerSecond: number;
  agendadaPara: string | null;
  iniciadaEm: string | null;
  finalizadaEm: string | null;
  /** Contadores, mantidos pelo worker durante o envio. */
  totalDestinatarios: number;
  enviados: number;
  falhas: number;
  bloqueados: number;
  ignorados: number;
  criadaEm: string;
}

/** Previa do publico antes de disparar. */
export interface PreviaDoPublico {
  /** Quantos receberiam a campanha se ela comecasse agora. */
  elegiveis: number;
  /** Total de contatos do bot, para comparacao. */
  totalNoBot: number;
  /** Tempo estimado de envio, em segundos. */
  duracaoEstimadaSegundos: number;
}
