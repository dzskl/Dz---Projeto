import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Aponta o .env para as URLs publicas do Codespaces.
 *
 * No Codespaces o navegador nao roda na mesma maquina que o codigo: localhost
 * nao existe do lado de quem acessa. Os enderecos reais sao os das portas
 * encaminhadas, e sao eles que precisam estar no .env — senao o painel abre mas
 * nenhuma chamada a API completa.
 *
 * Como painel e API ficam em hosts diferentes, a requisicao e cross-site e o
 * cookie de sessao passa a exigir SameSite=None; Secure. As duas URLs sao HTTPS,
 * entao isso funciona — e a API decide sozinha comparando WEB_ORIGIN com
 * API_PUBLIC_URL.
 */

const nome = process.env.CODESPACE_NAME;
const dominio = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? 'app.github.dev';

if (!nome) {
  console.error('CODESPACE_NAME nao esta definida — isto so funciona dentro de um Codespace.');
  console.error('Rodando local? Nao precisa deste comando: o .env ja vem com localhost.');
  process.exit(1);
}

if (!existsSync('.env')) {
  console.error('.env nao encontrado. Rode `pnpm env:criar` antes.');
  process.exit(1);
}

const painel = `https://${nome}-3000.${dominio}`;
const api = `https://${nome}-3333.${dominio}`;

const valores = {
  WEB_ORIGIN: painel,
  API_PUBLIC_URL: api,
  NEXT_PUBLIC_API_URL: api,
};

let conteudo = readFileSync('.env', 'utf8');
for (const [chave, valor] of Object.entries(valores)) {
  const linha = new RegExp(`^${chave}=.*$`, 'm');
  conteudo = linha.test(conteudo)
    ? conteudo.replace(linha, `${chave}=${valor}`)
    : `${conteudo.trimEnd()}\n${chave}=${valor}\n`;
}
writeFileSync('.env', conteudo);

console.log('.env atualizado para o Codespaces:\n');
console.log(`  Painel  ${painel}`);
console.log(`  API     ${api}\n`);
console.log('Falta um passo manual: na aba PORTS do VS Code, clique com o botao');
console.log('direito na porta 3333 e marque Port Visibility > Public.');
console.log('Sem isso o navegador recebe a tela de login do GitHub em vez da API.');
