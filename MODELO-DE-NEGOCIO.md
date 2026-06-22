# 🧩 Modelo de Negócio — Fábrica de Micro-SaaS com Acesso por Código

> Blueprint para replicar a operação do StoryMatch AI (RizzAI) em outros produtos.
> Guarde este documento. Ele é a "receita" do negócio.

---

## 1. A ideia em uma frase

> **Criar pequenos apps de IA que resolvem UMA dor específica, anunciar no tráfego pago
> (rastreado pela UTMify), vender o acesso na Cakto, e entregar via um código que o
> comprador usa para criar a conta.**

Cada produto é um "micro-SaaS": simples, focado, fácil de explicar num anúncio de 15 segundos.
A mesma estrutura técnica serve para todos — muda só o "tema" e o prompt da IA.

---

## 2. Por que esse modelo funciona

- **Custo baixo de produção**: o app é uma página + um backend que chama uma IA (Gemini). Sem app de loja, sem cadastro complexo.
- **Dor clara = anúncio fácil**: "manda o print, ela responde" vende sozinho. Todo produto novo precisa de uma dor assim.
- **Caixa rápido**: venda direta na Cakto, sem mensalidade obrigatória (tem plano único/vitalício).
- **Escala por repetição**: validou um, clona a estrutura e troca o tema. Você vira uma *fábrica* de SaaS.
- **Controle total do acesso**: código → conta. Você sabe quem comprou, quanto usou e pode cortar acesso.

---

## 3. O motor (como o dinheiro entra)

```
   ANÚNCIO (Meta/TikTok Ads)
        │   ← UTMify rastreia de qual anúncio veio cada venda
        ▼
   PÁGINA DE VENDAS (pagvendas.html)
        │   ← copy de dor → solução → prova → planos → garantia
        ▼
   CHECKOUT (Cakto)
        │   ← pagamento aprovado dispara o webhook
        ▼
   WEBHOOK gera o CÓDIGO automaticamente
        │
        ▼
   PÁGINA DE OBRIGADO (obrigado.html) mostra o código
        │
        ▼
   APP (app.html): código cria a CONTA (email+senha) → cliente usa
```

Você ganha em 2 frentes:
1. **Venda** do acesso (caixa imediato).
2. **Dados da UTMify** pra saber qual anúncio dá lucro e escalar só os que funcionam.

---

## 4. A arquitetura reaproveitável (o "esqueleto")

Tudo isso **já está pronto** no projeto e serve para qualquer produto novo:

| Peça | Arquivo | Reaproveita? |
|------|---------|--------------|
| Backend (API, contas, planos, limites) | `server.js` | ✅ 100% |
| Banco de dados (produtos, códigos, contas, logs) | `db.js` | ✅ 100% |
| Login/cadastro com código + senha (JWT) | `app.html` (auth) | ✅ 100% |
| Painel admin (gerar códigos, ver contas) | `admin.html` | ✅ 100% |
| Página de obrigado (entrega do código) | `obrigado.html` | ✅ 100% |
| Webhook da Cakto + idempotência | `server.js` | ✅ 100% |
| Segurança (rate limit, bcrypt, fail-closed) | `server.js` | ✅ 100% |
| Identidade visual (design system glass/neon) | CSS no topo de cada página | ✅ trocar só cores |

**O que muda em cada produto novo:**

| O que muda | Onde |
|------------|------|
| Tema/nicho e nome | textos das páginas |
| O **prompt da IA** (o coração do produto) | `server.js` (`promptStory`/`promptChat`) |
| A **dor e a copy** de vendas | `pagvendas.html` |
| As **cores** da marca | variáveis CSS (`--rose`, `--purple`, etc.) |
| O **tipo de entrada** (foto? texto? áudio?) | `app.html` |
| Os **planos e preços** | `db.js` (`PLANS`) + `pagvendas.html` |

> Regra de ouro: **80% é reaproveitado, 20% é o tema.** É isso que torna a fábrica viável.

---

## 5. Passo a passo para clonar um novo SaaS

1. **Escolha uma dor específica** (veja ideias na seção 7). Teste: "dá pra explicar em 1 frase?"
2. **Copie o projeto** para uma nova pasta/repo.
3. **Reescreva o prompt da IA** em `server.js` para a nova tarefa. *(Esse é o trabalho principal.)*
4. **Troque a copy** em `pagvendas.html` (dor → solução → prova → planos) e o nome/cores.
5. **Ajuste a entrada** em `app.html` se o produto não usar foto (ex.: campo de texto).
6. **Defina os planos** em `db.js` (`PLANS`) e os preços em `pagvendas.html`.
7. **Cadastre o produto na Cakto** e pegue os IDs das ofertas.
8. **Configure** `.env` (chave da IA, `ADMIN_PASSWORD`, `JWT_SECRET`, `CAKTO_*`).
9. **Suba numa VPS** (nginx + SSL + pm2) e aponte o webhook/redirect da Cakto.
10. **Coloque o pixel da UTMify** na `pagvendas.html` e suba o anúncio.
11. **Valide com tráfego pequeno**. Deu lucro? Escala. Não deu? Mata e parte pro próximo.

> Um produto novo, do zero, deve levar **1–2 dias** de trabalho com essa base pronta.

---

## 6. Evolução (Fase 3 — opcional, quando tiver vários)

Quando você tiver 2–3 produtos vendendo, vale transformar a fábrica num **monorepo multi-SaaS**:

```
/plataforma/        ← um backend só, várias "marcas"
  apps/
    rizzai/         ← cada produto = pasta com suas páginas e prompt
    produto2/
    produto3/
```

Vantagem: um servidor, um banco (a tabela `products` já existe pra isso!), um painel admin
pra tudo. Mas **só faça isso depois de validar** — no começo, clonar pasta é mais rápido.

---

## 7. Ideias de outros micro-SaaS no mesmo modelo

Mesma estrutura, só muda o prompt e o tema:

| Produto | Dor | Entrada → Saída |
|---------|-----|-----------------|
| **Bio Perfeita** | "não sei o que escrever na bio do Insta/Tinder" | nicho/fotos → 5 bios prontas |
| **Resposta Pronta (vendas)** | vendedor trava no "vou pensar" do cliente | print da conversa → resposta que fecha |
| **Legenda que Vende** | criador não sabe legenda pro post | foto do post → 5 legendas + hashtags |
| **CV Turbo** | candidato trava no currículo | dados → currículo + carta de apresentação |
| **Cantada Reversa** | quer saber se ela tá afim | print da conversa → análise do interesse dela |
| **Treino/Dieta IA** | não sabe montar treino/dieta | objetivo + dados → plano da semana |
| **Petição Fácil** | pequeno problema jurídico | situação → modelo de documento |

> Critério pra escolher: **dor aguda + resultado em segundos + fácil de mostrar no anúncio.**

---

## 8. Checklist de lançamento (por produto)

- [ ] Prompt da IA testado com 10+ exemplos reais
- [ ] Página de vendas com dor, prova social e garantia
- [ ] Planos e preços definidos
- [ ] Produto e ofertas criados na Cakto
- [ ] Webhook + página de obrigado testados ponta a ponta
- [ ] `.env` com segredos fortes (admin, JWT, webhook)
- [ ] VPS no ar com HTTPS
- [ ] Pixel da UTMify instalado e disparando
- [ ] Anúncio aprovado e rodando com orçamento de teste
- [ ] Métrica de decisão definida (ex.: ROAS mínimo para escalar)

---

**Resumo:** você não tem *um* produto — você tem uma **máquina de fazer produtos**.
O StoryMatch AI é o primeiro molde. Replicar é trocar o tema e o prompt. 🚀
