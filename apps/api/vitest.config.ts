import { config as loadDotenv } from 'dotenv';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * O .env precisa ser lido aqui, e nao so pelo @tg/config.
 *
 * Este arquivo escolhe o banco de teste antes de qualquer modulo da aplicacao
 * carregar. Sem isto, `pnpm test` num terminal limpo enxergaria DATABASE_URL
 * vazia e o Prisma falharia — mesmo com o .env no lugar certo.
 */
loadDotenv({ path: new URL('../../.env', import.meta.url).pathname });

/**
 * Banco de testes separado.
 *
 * Os testes limpam tabelas inteiras com deleteMany. Apontados para o banco de
 * desenvolvimento, apagariam os bots e contatos reais de quem estivesse
 * trabalhando — e o estrago so apareceria depois. TEST_DATABASE_URL isola isso;
 * sem ela, o padrao acrescenta "_test" ao nome do banco.
 */
function bancoDeTeste(): string {
  const explicito = process.env.TEST_DATABASE_URL;
  if (explicito) return explicito;

  const url = process.env.DATABASE_URL;
  if (!url) return '';
  // Acrescenta _test ao nome do banco, preservando usuario, host e parametros.
  return url.replace(/\/([^/?]+)(\?|$)/, '/$1_test$2');
}

process.env.DATABASE_URL = bancoDeTeste();

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
