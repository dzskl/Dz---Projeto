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
