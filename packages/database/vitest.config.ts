import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

// Lido aqui porque a escolha do banco acontece antes de qualquer modulo da
// aplicacao carregar; sem isto, `pnpm test` num terminal limpo veria a URL vazia.
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

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
