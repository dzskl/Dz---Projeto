import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * O .env do monorepo fica na raiz; o Next procura na pasta do proprio app.
 *
 * Sem isto, NEXT_PUBLIC_API_URL nunca chega ao bundle e o painel nao sabe onde
 * a API esta — mesmo com o valor correto no .env. O sintoma engana, porque a
 * tela abre normalmente e so as chamadas falham.
 *
 * fileURLToPath, e nao url.pathname: no Windows o pathname vem como
 * "/C:/caminho" e o arquivo nao e encontrado.
 */
loadDotenv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Os pacotes do monorepo sao publicados como TypeScript compilado para
  // CommonJS; transpilar aqui evita divergencia de formato no bundle.
  transpilePackages: ['@tg/shared'],
  /**
   * Origens permitidas para o servidor de desenvolvimento.
   *
   * Em Codespaces, Gitpod ou atras de um tunel, o navegador acessa o painel por
   * um dominio publico e nao por localhost. O Next trata isso como requisicao
   * cross-origin ao /_next/* e reclama; sem esta lista, o hot reload e os
   * recursos internos falham nesses ambientes.
   */
  allowedDevOrigins: ['*.app.github.dev', '*.githubpreview.dev', '*.gitpod.io'],
};

export default nextConfig;
