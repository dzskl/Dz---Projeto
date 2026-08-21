/**
 * Enums de dominio.
 *
 * Estes valores sao espelhados no schema do Prisma (packages/database). Quando um
 * enum mudar aqui, o schema precisa mudar junto — o teste em enums.test.ts existe
 * para que a divergencia quebre o build em vez de virar bug em producao.
 */

/** Papeis administrativos. Hoje todos os donos usam OWNER; os demais existem para o RBAC futuro. */
export const AdminRole = {
  /** Acesso total, incluindo gerenciar outros admins. */
  OWNER: 'OWNER',
  /** Acesso operacional total, sem gerenciar admins. */
  ADMIN: 'ADMIN',
  /** Cria e executa campanhas, nao mexe em bots nem admins. */
  OPERATOR: 'OPERATOR',
  /** Somente leitura. */
  VIEWER: 'VIEWER',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

/** Situacao da conexao de um bot com o Telegram. */
export const BotStatus = {
  /** Cadastrado, token valido, webhook registrado. */
  CONNECTED: 'CONNECTED',
  /** Desligado pelo admin — nao envia nem recebe. */
  DISABLED: 'DISABLED',
  /** Token recusado pelo Telegram (revogado no BotFather, por exemplo). */
  INVALID_TOKEN: 'INVALID_TOKEN',
  /** Ultima verificacao falhou por erro de rede ou da API. */
  ERROR: 'ERROR',
} as const;
export type BotStatus = (typeof BotStatus)[keyof typeof BotStatus];

/** Tipo de chat do Telegram. */
export const ChatType = {
  PRIVATE: 'PRIVATE',
  GROUP: 'GROUP',
  SUPERGROUP: 'SUPERGROUP',
  CHANNEL: 'CHANNEL',
} as const;
export type ChatType = (typeof ChatType)[keyof typeof ChatType];

/** Situacao do bot dentro de um grupo/canal. Espelha o `status` de ChatMember. */
export const BotChatStatus = {
  MEMBER: 'MEMBER',
  ADMINISTRATOR: 'ADMINISTRATOR',
  LEFT: 'LEFT',
  KICKED: 'KICKED',
} as const;
export type BotChatStatus = (typeof BotChatStatus)[keyof typeof BotChatStatus];

/**
 * Elegibilidade de um usuario para receber mensagens de um bot.
 *
 * Apenas ACTIVE pode receber campanha. Os demais estados sao terminais ate que o
 * proprio usuario volte a interagir.
 */
export const BotUserStatus = {
  /** Interagiu no privado e nao pediu para sair. Unico estado elegivel. */
  ACTIVE: 'ACTIVE',
  /** Bloqueou o bot (403 no envio ou update my_chat_member). */
  BLOCKED_BOT: 'BLOCKED_BOT',
  /** Conta desativada no Telegram. */
  DEACTIVATED: 'DEACTIVATED',
  /** Pediu para sair via /stop ou foi removido manualmente. */
  UNSUBSCRIBED: 'UNSUBSCRIBED',
} as const;
export type BotUserStatus = (typeof BotUserStatus)[keyof typeof BotUserStatus];

/** Como o usuario entrou na base — a prova de consentimento. */
export const ConsentSource = {
  /** Enviou /start no privado. Consentimento mais forte. */
  START_COMMAND: 'START_COMMAND',
  /** Mandou uma mensagem qualquer no privado. */
  PRIVATE_MESSAGE: 'PRIVATE_MESSAGE',
  /** Clicou num botao inline do bot. */
  CALLBACK_QUERY: 'CALLBACK_QUERY',
  /** Adicionado manualmente por um admin (exige justificativa). */
  MANUAL: 'MANUAL',
} as const;
export type ConsentSource = (typeof ConsentSource)[keyof typeof ConsentSource];

/** Motivo pelo qual um usuario entrou na lista de opt-out. */
export const OptOutReason = {
  /** Pediu explicitamente (/stop). */
  USER_REQUEST: 'USER_REQUEST',
  /** Bloqueou o bot. */
  BLOCKED_BOT: 'BLOCKED_BOT',
  /** Conta desativada. */
  DEACTIVATED: 'DEACTIVATED',
  /** Decisao administrativa. */
  MANUAL: 'MANUAL',
} as const;
export type OptOutReason = (typeof OptOutReason)[keyof typeof OptOutReason];

/** Ciclo de vida de uma campanha. */
export const CampaignStatus = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const;
export type CampaignStatus = (typeof CampaignStatus)[keyof typeof CampaignStatus];

/**
 * Transicoes validas de status de campanha.
 *
 * Centralizado aqui para que API, worker e front concordem sobre o que pode
 * acontecer — evitar que uma campanha CANCELLED volte a rodar, por exemplo.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  DRAFT: ['SCHEDULED', 'RUNNING', 'CANCELLED'],
  SCHEDULED: ['RUNNING', 'DRAFT', 'CANCELLED'],
  RUNNING: ['PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  PAUSED: ['RUNNING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: ['RUNNING', 'CANCELLED'],
} as const;

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

/** Situacao de um destinatario dentro de uma campanha. */
export const RecipientStatus = {
  /** Materializado, ainda nao enfileirado. */
  PENDING: 'PENDING',
  /** Job criado na fila. */
  QUEUED: 'QUEUED',
  /** Entregue ao Telegram com sucesso. */
  SENT: 'SENT',
  /** Erro definitivo apos as tentativas. */
  FAILED: 'FAILED',
  /** Nao enviado porque virou opt-out depois da materializacao. */
  SKIPPED: 'SKIPPED',
  /** Usuario bloqueou o bot — nao tentar de novo. */
  BLOCKED: 'BLOCKED',
} as const;
export type RecipientStatus = (typeof RecipientStatus)[keyof typeof RecipientStatus];

/** Tipos de mensagem suportados no envio. */
export const MessageKind = {
  TEXT: 'TEXT',
  PHOTO: 'PHOTO',
  VIDEO: 'VIDEO',
  DOCUMENT: 'DOCUMENT',
  AUDIO: 'AUDIO',
  VOICE: 'VOICE',
  ANIMATION: 'ANIMATION',
} as const;
export type MessageKind = (typeof MessageKind)[keyof typeof MessageKind];

/** Severidade de eventos de sistema exibidos como alertas no painel. */
export const EventSeverity = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
} as const;
export type EventSeverity = (typeof EventSeverity)[keyof typeof EventSeverity];

/** Acoes administrativas registradas na auditoria. */
export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_UPDATED: 'ADMIN_UPDATED',
  ADMIN_DELETED: 'ADMIN_DELETED',
  BOT_CREATED: 'BOT_CREATED',
  BOT_UPDATED: 'BOT_UPDATED',
  BOT_DELETED: 'BOT_DELETED',
  CAMPAIGN_CREATED: 'CAMPAIGN_CREATED',
  CAMPAIGN_UPDATED: 'CAMPAIGN_UPDATED',
  CAMPAIGN_STARTED: 'CAMPAIGN_STARTED',
  CAMPAIGN_PAUSED: 'CAMPAIGN_PAUSED',
  CAMPAIGN_RESUMED: 'CAMPAIGN_RESUMED',
  CAMPAIGN_CANCELLED: 'CAMPAIGN_CANCELLED',
  OPT_OUT_ADDED: 'OPT_OUT_ADDED',
  OPT_OUT_REMOVED: 'OPT_OUT_REMOVED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
