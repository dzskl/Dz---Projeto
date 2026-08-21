# Imagem de producao da API.
#
# O painel (apps/web) nao entra aqui: ele vai para a Vercel. Esta imagem sobe a
# API, os webhooks e os workers de envio — que precisam de um processo continuo.
#
#   docker build -t tg-api .
#   docker run --env-file .env -p 3333:3333 tg-api

# Debian slim, e nao Alpine: o Prisma e o @node-rs/argon2 sao binarios nativos e
# a troca de glibc por musl e uma fonte classica de erro que so aparece em
# producao.
FROM node:22-bookworm-slim AS base
# O Prisma precisa do OpenSSL para falar com o Postgres.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME="/pnpm" PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM base AS build

# Sem TTY, o pnpm se recusa a apagar node_modules e o `install --prod` la embaixo
# aborta com ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY. CI=true e a forma
# suportada de dizer que ninguem esta assistindo para confirmar.
ENV CI=true

COPY . .

RUN pnpm install --frozen-lockfile

# Os pacotes do workspace sao publicados como dist/, que nao vai para o Git:
# sem compilar aqui, a API nao encontra @tg/shared nem @tg/database.
RUN pnpm --filter @tg/database run generate \
  && pnpm -r --filter "./packages/**" build \
  && pnpm --filter @tg/api build

# Remove as dependencias de desenvolvimento agora que o build terminou.
RUN pnpm install --frozen-lockfile --prod

# O passo acima reconstroi node_modules e leva junto o client gerado pelo
# Prisma; por isso ele e gerado de novo, e nao antes.
RUN pnpm --filter @tg/database run generate

# ---------------------------------------------------------------------------
# Execucao
# ---------------------------------------------------------------------------
FROM base AS runner

ENV NODE_ENV=production

COPY --from=build --chown=node:node /app /app

# Sem privilegios: a aplicacao nao escreve em disco.
USER node

EXPOSE 3333

# As migrations rodam a cada boot. `migrate deploy` so aplica o que falta e nao
# apaga nada — subir a API com o banco atrasado quebraria na primeira consulta.
CMD ["sh", "-c", "pnpm --filter @tg/database run deploy && node apps/api/dist/main.js"]
