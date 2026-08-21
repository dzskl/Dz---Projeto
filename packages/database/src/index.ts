import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Cliente Prisma compartilhado.
 *
 * Em desenvolvimento o hot reload recria modulos varias vezes; guardar a
 * instancia no globalThis evita abrir uma nova pool de conexoes a cada reload e
 * estourar o limite do Postgres.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
        : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

/** Verifica a conexao — usado no health check da API e do worker. */
export async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'erro desconhecido',
    };
  }
}

/**
 * Serializa BigInt para JSON.
 *
 * IDs do Telegram sao BigInt e `JSON.stringify` lanca excecao neles. Converter
 * para string preserva a precisao, que se perderia em `Number`.
 */
export function serializeBigInt<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, val: unknown) => (typeof val === 'bigint' ? val.toString() : val)),
  ) as T;
}
