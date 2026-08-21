# Deploy

O projeto tem duas partes com necessidades diferentes. Publicar as duas no mesmo
lugar nao funciona, e e por isso que a Vercel vinha falhando.

| Parte | Onde publicar | Por que |
|---|---|---|
| `apps/web` — painel | **Vercel** | Next.js estatico + cliente; e o caso de uso da Vercel |
| `apps/api` — API, webhooks e workers | **Provedor com processo continuo** (Railway, Render, Fly.io, VPS com Docker) | Precisa ficar de pe o tempo todo |

## Por que a API nao roda na Vercel

Nao e questao de configuracao — e incompatibilidade de modelo.

1. **Os workers de envio sao processos continuos.** `EnvioService.onModuleInit`
   sobe um `Worker` do BullMQ por bot, que fica escutando o Redis. Uma funcao
   serverless existe apenas durante uma requisicao e e encerrada logo depois:
   nao ha onde esse worker viver.
2. **Uma campanha leva minutos ou horas.** A 20 mensagens por segundo, 50 mil
   contatos levam mais de 40 minutos. O limite de execucao de uma funcao e de
   segundos.
3. **A conexao com o Redis e o Postgres e persistente.** Em serverless, cada
   invocacao abriria uma conexao nova e o banco esgotaria o limite.

A API tambem precisa de um endereco HTTPS fixo para receber os webhooks do
Telegram, o que combina melhor com um servico sempre no ar.

---

## 1. Painel na Vercel

Em **Settings → General**:

| Campo | Valor |
|---|---|
| Root Directory | **`apps/web`** |
| Include files outside the root directory | **Enabled** |
| Framework Preset | Next.js (detectado sozinho) |
| Build / Install / Output | deixe herdar do `apps/web/vercel.json` |

O `Root Directory` **precisa** ser `apps/web`, e nao a raiz. A Vercel procura a
dependencia `next` no `package.json` daquele diretorio para saber que projeto
esta construindo. Na raiz do monorepo esse `package.json` nao tem `next` — ele
so orquestra o workspace — e o deploy morre em cerca de um segundo com
`No Next.js version detected`, antes de instalar qualquer coisa.

O `Include files outside the root directory` precisa continuar ligado: e o que
permite ao build enxergar o `pnpm-workspace.yaml`, o `pnpm-lock.yaml` e a pasta
`packages/`, todos acima de `apps/web`.

Em **Settings → Environment Variables**, defina:

| Variavel | Valor |
|---|---|
| `NEXT_PUBLIC_API_URL` | endereco HTTPS da sua API, ex.: `https://api.seudominio.com` |

Essa variavel e embutida no bundle **durante o build**. Alterar depois exige
publicar de novo — nao basta salvar e recarregar a pagina.

### Por que o build quebrava mesmo com o Root Directory certo

O painel importa `@tg/shared`, cujo `package.json` aponta para `dist/`. Como
`dist/` nao e versionado, num clone limpo esse diretorio nao existe e o
`next build` para com `Module not found: Can't resolve '@tg/shared'`. O
`buildCommand` do `apps/web/vercel.json` compila o pacote antes do painel.

---

## 2. API em um provedor com processo continuo

A API precisa de PostgreSQL 15+, Redis e HTTPS.

```bash
# No servidor
git clone <repo> && cd Dz---Projeto
cp .env.example .env    # preencha os segredos
docker compose up -d    # Postgres + Redis
pnpm install
pnpm db:deploy
pnpm build
node apps/api/dist/main.js
```

Variaveis obrigatorias no `.env` da API:

| Variavel | Observacao |
|---|---|
| `DATABASE_URL` | PostgreSQL 15 ou superior (o indice de opt-out usa `NULLS NOT DISTINCT`) |
| `REDIS_URL` | fila de envio |
| `SESSION_SECRET` | `openssl rand -base64 48` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` — **se perder, os tokens dos bots ficam irrecuperaveis** |
| `API_PUBLIC_URL` | endereco HTTPS publico da API; e o que monta a URL do webhook |
| `WEB_ORIGIN` | endereco do painel na Vercel; e a unica origem liberada no CORS |
| `NODE_ENV` | `production` |

---

## 3. O cookie de sessao entre dominios

Com o painel na Vercel e a API em outro provedor, as duas pontas ficam em hosts
diferentes e a requisicao passa a ser **cross-site**. Um cookie `SameSite=Lax`
simplesmente nao e enviado nesse cenario: o login responde 200, mas a chamada
seguinte volta 401 e o painel devolve para a tela de login em ciclo.

A API resolve isso sozinha comparando `WEB_ORIGIN` com `API_PUBLIC_URL`
(`opcoesDoCookie`, em `apps/api/src/auth/session.service.ts`):

- **mesmo host** (desenvolvimento) → `SameSite=Lax`
- **hosts diferentes** (producao) → `SameSite=None; Secure`

Como `None` exige `Secure`, **a API precisa estar em HTTPS**. Sem isso o
navegador descarta o cookie e o sintoma e o mesmo ciclo de login.

Preencher `WEB_ORIGIN` e `API_PUBLIC_URL` corretamente e o que faz essa escolha
acontecer — nao ha nada a configurar alem disso.

---

## Ordem recomendada

1. Suba a API com HTTPS e anote o endereco.
2. Publique o painel na Vercel com `NEXT_PUBLIC_API_URL` apontando para ela.
3. Volte ao `.env` da API e ajuste `WEB_ORIGIN` para o endereco da Vercel.
4. Reinicie a API (o CORS e o cookie leem esses valores no boot).
