import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Validacao das variaveis de ambiente.
 *
 * O processo falha no boot se algo estiver faltando ou invalido — e melhor nao
 * subir do que subir sem chave de criptografia e descobrir na primeira campanha.
 */

loadDotenv();

const nodeEnv = z.enum(['development', 'test', 'production']);

/** Chave de 32 bytes em hex (64 caracteres) para AES-256-GCM. */
const hex32Bytes = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'Precisa ser hexadecimal de 64 caracteres (32 bytes). Gere com: openssl rand -hex 32');

const schema = z.object({
  NODE_ENV: nodeEnv.default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  /** URL publica da API — usada para montar o endereco do webhook do Telegram. */
  API_PUBLIC_URL: z.string().url().default('http://localhost:3333'),
  /** Origem do painel, liberada no CORS. */
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  /** Assina o cookie de sessao. */
  SESSION_SECRET: z.string().min(32, 'Use pelo menos 32 caracteres.'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  /** Criptografa os tokens de bot no banco (AES-256-GCM). */
  ENCRYPTION_KEY: hex32Bytes,

  /** Teto de mensagens por segundo por bot. O Telegram corta perto de 30. */
  TELEGRAM_DEFAULT_RATE_PER_SECOND: z.coerce.number().int().min(1).max(30).default(20),
  TELEGRAM_MAX_SEND_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Le e valida o ambiente uma unica vez.
 *
 * Em caso de erro, imprime todas as variaveis com problema de uma vez em vez de
 * uma por execucao.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variaveis de ambiente invalidas:\n${issues}\n\nVeja o .env.example.`);
  }

  cached = parsed.data;
  return cached;
}

/** Apenas para testes: forca a releitura do ambiente. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
export const isTest = (): boolean => getEnv().NODE_ENV === 'test';
