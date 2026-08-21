import { defineConfig } from 'vitest/config';

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
