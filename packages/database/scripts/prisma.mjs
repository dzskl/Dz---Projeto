import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { config as loadDotenv } from 'dotenv';

/**
 * Executa a CLI do Prisma com o .env da raiz ja carregado.
 *
 * O Prisma procura o .env no diretorio de onde foi chamado. Como os scripts
 * deste pacote rodam com o diretorio atual em `packages/database`, o arquivo da
 * raiz do monorepo ficava invisivel e `prisma migrate deploy` parava com
 * "Environment variable not found: DATABASE_URL" — apesar de o .env existir e
 * estar correto.
 *
 * Em producao (container, Railway) nao ha .env: as variaveis ja vem do
 * ambiente, a busca nao encontra nada e o Prisma roda com o que recebeu.
 */

function acharEnv() {
  const raiz = parse(process.cwd()).root;
  let atual = process.cwd();

  for (;;) {
    const candidato = join(atual, '.env');
    if (existsSync(candidato)) return candidato;
    if (atual === raiz) return undefined;
    atual = dirname(atual);
  }
}

const arquivo = acharEnv();
if (arquivo) loadDotenv({ path: arquivo });

const resultado = spawnSync('prisma', process.argv.slice(2), {
  stdio: 'inherit',
  // No Windows a CLI e um .cmd, que o spawn so encontra atraves do shell.
  shell: process.platform === 'win32',
});

process.exit(resultado.status ?? 1);
