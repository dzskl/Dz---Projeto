# Plataforma de Gestao e Automacao para Telegram

Painel web para gerenciar bots do Telegram, manter uma base de contatos opt-in e
enviar campanhas com fila, controle de velocidade e monitoramento.

---

## O que a Bot API do Telegram permite

Tres limites definem o produto. Nao sao decisoes de projeto — sao da API:

1. **O bot nao inicia conversa.** So e possivel enviar mensagem privada para quem
   ja deu `/start` no bot. Enviar para qualquer outra pessoa retorna `403`.
2. **Nao existe listagem de membros de grupo/canal.** A API expoe apenas os
   administradores e a contagem total.
3. **Limites de velocidade rigidos.** ~30 mensagens/segundo por bot e 1 por
   segundo por chat. O padrao do projeto e 20/s, com margem proposital.

A plataforma, portanto, gerencia **a sua base opt-in** — ela nao cria contatos do
nada.

---

## Stack

| Camada | Tecnologia |
|---|---|
| Linguagem | TypeScript |
| API | NestJS |
| Painel | Next.js + Tailwind |
| Banco | PostgreSQL 16 + Prisma |
| Fila | BullMQ + Redis |
| Telegram | grammY |
| Logs | Pino (JSON) |
| Testes | Vitest |

---

## Como rodar

**Pre-requisitos:** Node 20+, pnpm 10+, Docker.

```bash
# 1. Dependencias
pnpm install

# 2. Infraestrutura (Postgres + Redis)
docker compose up -d

# 3. Configuracao
cp .env.example .env
#    Gere os segredos e cole no .env:
openssl rand -base64 48   # -> SESSION_SECRET
openssl rand -hex 32      # -> ENCRYPTION_KEY

# 4. Banco
pnpm db:generate
pnpm db:deploy

# 5. Contas de dono (a senha e exibida uma unica vez)
SEED_ADMIN_EMAILS="voce@dominio.com,socio@dominio.com" pnpm db:seed

# 6. Subir tudo
pnpm dev
```

| Servico | Endereco |
|---|---|
| Painel | http://localhost:3000 |
| API | http://localhost:3333 |

> `ENCRYPTION_KEY` cifra os tokens dos bots. **Se essa chave for perdida, os
> tokens salvos ficam irrecuperaveis** e cada bot precisa ser recadastrado.

---

## Estrutura

```
.
├── apps/
│   ├── api/          NestJS — REST, webhooks, SSE
│   ├── web/          Next.js — painel
│   └── worker/       BullMQ — envio das campanhas
├── packages/
│   ├── database/     Prisma: schema, migrations, seed
│   ├── shared/       enums, schemas Zod, erros de dominio
│   └── config/       ambiente validado, logger
└── docker-compose.yml
```

---

## Scripts

| Comando | O que faz |
|---|---|
| `pnpm dev` | Sobe API, worker e painel |
| `pnpm build` | Compila tudo |
| `pnpm test` | Roda os testes |
| `pnpm typecheck` | Verifica tipos |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm db:migrate` | Cria migration (desenvolvimento) |
| `pnpm db:deploy` | Aplica migrations (producao) |
| `pnpm db:seed` | Cria contas de dono |
| `pnpm db:studio` | Abre o Prisma Studio |

---

## Banco de dados

15 tabelas. Quatro garantias sao impostas pelo **banco**, nao pela aplicacao —
resistem a bug, corrida entre workers e reprocessamento:

| Garantia | Como |
|---|---|
| Nenhum destinatario recebe a mesma campanha duas vezes | unico `(campaign_id, bot_user_id)` |
| Webhook reentregue nao duplica efeito | unico `(bot_id, update_id)` |
| Uma pessoa tem um unico vinculo por bot | unico `(bot_id, telegram_user_id)` |
| Um unico opt-out global por pessoa | unico `(bot_id, telegram_user_id)` **NULLS NOT DISTINCT** |

A ultima exige **PostgreSQL 15+**: por padrao o Postgres trata `NULL` como
distinto de `NULL`, o que permitiria varios opt-outs globais para a mesma pessoa.
Ha teste de regressao em `packages/database/src/constraints.test.ts`.

---

## Seguranca

- Senhas com **Argon2id** (parametros OWASP).
- Sessao em cookie `httpOnly` + `Secure` + `SameSite`, revogavel; o banco guarda
  apenas o hash do token.
- Tokens de bot cifrados com **AES-256-GCM**; a API devolve somente os 4 ultimos
  digitos.
- Webhook validado por `secret_token` unico por bot.
- Logs com redacao automatica de token, senha e cookie.
- Toda acao administrativa fica registrada em `audit_logs`.

Nunca coloque segredos no codigo: tudo vem do `.env` (desenvolvimento) ou do
Secret Manager (producao).

---

## Status

| Fase | Escopo | Situacao |
|---|---|---|
| 1 | Estrutura, banco, autenticacao, layout | banco e base concluidos |
| 2 | Integracao com Telegram e cadastro de bots | pendente |
| 3 | Usuarios, grupos, consentimento e opt-out | pendente |
| 4 | Campanhas, fila, workers e retry | pendente |
| 5 | Monitoramento e tempo real | pendente |
| 6 | Testes, seguranca, Docker e deploy | pendente |
