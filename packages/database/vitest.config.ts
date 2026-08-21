import { defineConfig } from 'vitest/config';

/**
 * Banco de testes separado.
 *
 * Os testes de constraint criam e apagam registros; apontados para o banco de
 * desenvolvimento, misturariam dados de teste com os reais.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  (process.env.DATABASE_URL ?? '').replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Testes de integracao compartilham o mesmo banco: rodar em serie evita
    // que a limpeza de um derrube o outro.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
