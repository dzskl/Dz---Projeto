import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Os testes compartilham o mesmo banco: rodar em serie evita interferencia.
    fileParallelism: false,
    testTimeout: 30_000,
  },
  plugins: [
    /**
     * O esbuild (padrao do Vitest) nao implementa `emitDecoratorMetadata`.
     * Sem esses metadados o NestJS nao descobre os tipos do construtor e a
     * injecao de dependencia entrega `undefined` — os guards quebram em tempo
     * de execucao mesmo com o typecheck limpo. O SWC emite os metadados.
     */
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { decoratorMetadata: true },
      },
    }),
  ],
});
