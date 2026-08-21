import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Cria o .env a partir do .env.example, ja com os segredos gerados.
 *
 * Existe para tirar do caminho o passo mais chato da instalacao: copiar o
 * exemplo, gerar duas chaves na mao e colar cada uma no lugar certo. E onde
 * costuma nascer o erro silencioso de deixar o valor de exemplo no ENCRYPTION_KEY.
 *
 * NUNCA sobrescreve um .env existente. Trocar o ENCRYPTION_KEY de um ambiente
 * que ja tem bots cadastrados torna os tokens salvos indecifraveis — perda de
 * dados irreversivel a partir de um comando que parece inofensivo.
 */

const DESTINO = '.env';
const EXEMPLO = '.env.example';

if (existsSync(DESTINO)) {
  console.log(`O ${DESTINO} ja existe — nada foi alterado.`);
  console.log('Apague-o antes se quiser comecar do zero (e perder as chaves atuais).');
  process.exit(0);
}

if (!existsSync(EXEMPLO)) {
  console.error(`${EXEMPLO} nao encontrado. Rode este comando na raiz do projeto.`);
  process.exit(1);
}

copyFileSync(EXEMPLO, DESTINO);

const substituicoes = [
  ['SESSION_SECRET', randomBytes(48).toString('base64')],
  ['ENCRYPTION_KEY', randomBytes(32).toString('hex')],
];

let conteudo = readFileSync(DESTINO, 'utf8');
for (const [chave, valor] of substituicoes) {
  const linha = new RegExp(`^${chave}=.*$`, 'm');
  if (!linha.test(conteudo)) {
    console.error(`${EXEMPLO} nao tem a linha ${chave}=. Verifique o arquivo.`);
    process.exit(1);
  }
  conteudo = conteudo.replace(linha, `${chave}=${valor}`);
}
writeFileSync(DESTINO, conteudo);

console.log(`${DESTINO} criado com SESSION_SECRET e ENCRYPTION_KEY gerados.`);
console.log('Guarde o ENCRYPTION_KEY: sem ele, os tokens dos bots ficam irrecuperaveis.');
