# StoryMatch AI (RizzAI)

SaaS que analisa prints de stories/conversas e gera respostas de paquera com IA (Google Gemini).
Acesso liberado por **código** — quem compra recebe um código e usa no app.

## 📁 Estrutura

```
.
├── server.js              # Backend Express (API + serve o /public)
├── package.json
├── database.json          # Banco local (gitignored — contém códigos reais)
├── database.example.json  # Modelo do banco
├── .env                   # Variáveis secretas (gitignored)
├── .env.example           # Modelo das variáveis
└── public/
    ├── index.html         # Landing de marketing
    ├── pagvendas.html     # Página de vendas (destino dos anúncios / UTMify)
    ├── app.html           # O APP: login por código + gerar respostas
    └── admin.html         # Painel admin: gerar/remover códigos, ver uso
```

## 🚀 Como rodar (local)

```bash
npm install
cp .env.example .env        # preencha GEMINI_API_KEY e ADMIN_PASSWORD
cp database.example.json database.json
npm start
```

Acesse:
- App: http://localhost:3000/app.html
- Vendas: http://localhost:3000/pagvendas.html
- Admin: http://localhost:3000/admin.html

## 🔑 Variáveis de ambiente (`.env`)

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor (padrão 3000) |
| `GEMINI_API_KEY` | Chave da API do Google Gemini (obrigatória p/ gerar) |
| `ADMIN_PASSWORD` | Senha do painel admin. **Sem ela, o admin fica bloqueado.** |
| `ALLOWED_ORIGIN` | (Opcional) Domínios liberados no CORS, separados por vírgula. |

## 🔒 Segurança aplicada (Fase 1)

- Painel admin **fail-closed** (bloqueado se `ADMIN_PASSWORD` não estiver definida).
- **Rate limiting** em memória: `/api/generate` (30/min) e login/admin (10/min).
- **CORS** restrito por `ALLOWED_ORIGIN`.
- Erros internos da IA **não** vazam para o cliente.
- `.env` e `database.json` fora do Git.

## 🗺️ Roadmap

- **Fase 1 (atual):** RizzAI no ar — segurança, página de vendas, app e admin com **códigos manuais**.
- **Fase 2:** Migrar para **SQLite**, sistema de **contas por produto** (código cria conta com email+senha) e **webhook automático da Cakto** (venda → gera código → entrega).
- **Fase 3:** Estrutura multi-SaaS (clonar novos produtos rápido) + integração de rastreio da **UTMify**.
```
