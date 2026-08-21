/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Os pacotes do monorepo sao publicados como TypeScript compilado para
  // CommonJS; transpilar aqui evita divergencia de formato no bundle.
  transpilePackages: ['@tg/shared'],
};

export default nextConfig;
