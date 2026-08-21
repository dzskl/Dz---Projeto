import pino, { type Logger } from 'pino';
import { getEnv } from './env.js';

/**
 * Logger estruturado (JSON).
 *
 * Em producao o Cloud Logging ingere JSON direto do stdout, entao nao ha
 * transporte nem arquivo — o container so escreve na saida padrao.
 */

/**
 * Campos que nunca podem ir para o log.
 *
 * Vale tanto para o token do bot quanto para senha, cookie e header de
 * autenticacao. Redigir aqui, num lugar so, e mais confiavel do que lembrar de
 * omitir em cada chamada.
 */
const REDACT_PATHS = [
  'token',
  'botToken',
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'secret',
  'sessionSecret',
  'encryptionKey',
  'webhookSecret',
  'authorization',
  'cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.token',
  '*.password',
];

export function createLogger(name: string): Logger {
  const env = getEnv();

  return pino({
    name,
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      // Cloud Logging espera "severity" em maiusculo.
      level: (label) => ({ level: label, severity: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Em desenvolvimento, log legivel; em producao, JSON puro.
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }
      : {}),
  });
}

export type { Logger };
