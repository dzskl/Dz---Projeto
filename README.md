# StoryMatch AI (RizzAI)

SaaS que analisa prints de stories/conversas e gera respostas de paquera com IA (Google Gemini).
Quem compra recebe um **código**, usa o código para **criar uma conta** (email + senha) e acessa o app.

## 📁 Estrutura

```
.
├── server.js              # Backend Express (API + serve o /public)
├── db.js                  # Banco SQLite: produtos, códigos, contas, logs
├── package.json
├── data.sqlite            # Banco local (gitignored)
├── .env                   # Variáveis secretas (gitignored)
├── .env.example           # Modelo das variáveis
└── public/
    ├── index.html         # Landing de marketing
    ├── pagvendas.html     # Página de vendas (destino dos anúncios / UTMify)
    ├── app.html           # O APP: criar conta / login + gerar respostas
    ├── obrigado.html      # Página de obrigado (Cakto redireciona p/ cá; mostra o código)
    └── admin.html         # Painel admin: gerar códigos, ver contas e uso
```

## 🚀 Como rodar (local)

```bash
npm install
cp .env.example .env        # preencha GEMINI_API_KEY, ADMIN_PASSWORD e JWT_SECRET
npm start
```

Acesse:
- App: http://localhost:3000/app.html
- Vendas: http://localhost:3000/pagvendas.html
- Admin: http://localhost:3000/admin.html

Fluxo: no **admin** você gera um código (escolhendo o plano) → entrega ao comprador →
ele abre o **app**, vai em "Criar conta", informa o código + email + senha, e já entra.

## 🔑 Variáveis de ambiente (`.env`)

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor (padrão 3000) |
| `GEMINI_API_KEY` | Chave da API do Google Gemini (obrigatória p/ gerar) |
| `ADMIN_PASSWORD` | Senha do painel admin. **Sem ela, o admin fica bloqueado.** |
| `JWT_SECRET` | Segredo p/ assinar os tokens de login. **Defina um valor fixo** (senão os logins caem ao reiniciar). |
| `ALLOWED_ORIGIN` | (Opcional) Domínios liberados no CORS, separados por vírgula. |
| `DB_PATH` | (Opcional) Caminho do arquivo SQLite (padrão `./data.sqlite`). |
| `CAKTO_WEBHOOK_SECRET` | Segredo do webhook da Cakto (em `?secret=` ou header `x-cakto-secret`). |
| `CAKTO_OFFER_MAP` | JSON mapeando oferta da Cakto → `{productSlug, plan}`. |

## 🧩 Planos

| Plano | Limite de gerações | Validade |
|-------|--------------------|----------|
| `starter` | 50 | 7 dias |
| `pro` | ilimitado | 30 dias |
| `vitalicio` | ilimitado | sem expiração |

(Definidos em `db.js` → `PLANS`.)

## 🔌 API (resumo)

| Rota | Auth | Descrição |
|------|------|-----------|
| `POST /api/register` | — | Resgata código e cria a conta (retorna token JWT) |
| `POST /api/login` | — | Login email+senha (retorna token JWT) |
| `GET /api/me` | Bearer | Dados da conta logada |
| `POST /api/generate` | Bearer | Gera 4 respostas (checa limite/validade do plano) |
| `GET /api/admin/data` | senha admin | Códigos, contas, logs, planos |
| `POST /api/admin/codes` | senha admin | Gera código `{productSlug, plan, code?}` |
| `DELETE /api/admin/codes` | senha admin | Remove código |
| `POST /api/webhook/cakto` | segredo | Pagamento aprovado → gera código (vinculado à transação) |
| `GET /api/order-code?ref=` | — | Página de obrigado busca o código gerado p/ a transação |

## 🔒 Segurança aplicada

- Admin **fail-closed** (bloqueado sem `ADMIN_PASSWORD`).
- Senhas com **bcrypt**; sessões via **JWT** (30 dias).
- **Rate limiting** em memória: gerar (30/min), login/cadastro/admin (12/min).
- Limite de uso e validade **enforçados por conta**.
- **CORS** restrito por `ALLOWED_ORIGIN`; erros internos da IA não vazam.
- `.env` e `data.sqlite` fora do Git.

## 🗺️ Roadmap

- **Fase 1 ✅** RizzAI no ar — segurança, página de vendas, app e admin.
- **Fase 2 ✅** SQLite + **contas por produto** (código cria conta) + **webhook da Cakto** +
  **página de obrigado** que mostra o código após a compra.
  - Falta ligar na Cakto real: configurar o **redirect** para `/obrigado.html?ref=<id_da_transação>`,
    o **CAKTO_WEBHOOK_SECRET** e o **CAKTO_OFFER_MAP** (oferta → plano), conforme o payload real.
- **Fase 3 ⏳** Estrutura multi-SaaS (clonar novos produtos rápido) + rastreio da **UTMify**.
```
