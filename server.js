const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const dbx = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Segredo do JWT. Se não definido, gera um efêmero (sessões caem ao reiniciar).
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  JWT_SECRET não definido no .env — usando um segredo temporário (logins caem ao reiniciar).');
}

// Atrás de proxy reverso (nginx) na VPS, para req.ip correto.
app.set('trust proxy', 1);

// CORS restrito por ALLOWED_ORIGIN (separado por vírgula). Sem ele = liberado (dev).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN.split(',').map(s => s.trim()) } : {}));

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Rate limiter em memória (sem dependências) ----
function rateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + windowMs; }
    entry.count++;
    hits.set(req.ip, entry);
    if (entry.count > max) {
      return res.status(429).json({ error: message || 'Muitas requisições. Tente novamente em instantes.' });
    }
    next();
  };
}
const generateLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30, message: 'Limite de gerações por minuto atingido. Aguarde.' });
const authLimiter = rateLimiter({ windowMs: 60 * 1000, max: 12, message: 'Muitas tentativas. Aguarde um minuto.' });

// ---- Helpers de auth ----
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signToken(user) {
  return jwt.sign({ uid: user.id, pid: user.product_id }, JWT_SECRET, { expiresIn: '30d' });
}

function authRequired(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = dbx.getUserById(payload.uid);
    if (!user) return res.status(401).json({ error: 'Conta não encontrada.' });
    if (user.expires_at && new Date() > new Date(user.expires_at)) {
      return res.status(403).json({ error: 'Seu acesso expirou. Renove para continuar.' });
    }
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

function publicUser(u) {
  return {
    email: u.email, plan: u.plan,
    usageLimit: u.usage_limit, usageCount: u.usage_count,
    expiresAt: u.expires_at,
  };
}

// ======================= AUTENTICAÇÃO =======================

// Cadastro: resgata um código e cria a conta (conta por produto).
app.post('/api/register', authLimiter, async (req, res) => {
  const { code, email, password } = req.body || {};
  if (!code || !email || !password) return res.status(400).json({ error: 'Preencha código, email e senha.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Email inválido.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'A senha precisa ter ao menos 6 caracteres.' });

  const c = dbx.getCode(code.trim());
  if (!c) return res.status(404).json({ error: 'Código inválido.' });
  if (c.status === 'redeemed') return res.status(409).json({ error: 'Este código já foi usado.' });

  const emailNorm = String(email).trim().toLowerCase();
  if (dbx.getUser(emailNorm, c.product_id)) {
    return res.status(409).json({ error: 'Já existe uma conta com este email para este produto. Faça login.' });
  }

  const expiresAt = c.duration_days
    ? new Date(Date.now() + c.duration_days * 86400000).toISOString()
    : null;

  const passwordHash = await bcrypt.hash(password, 10);
  const user = dbx.createUser({
    email: emailNorm, passwordHash, productId: c.product_id,
    plan: c.plan, usageLimit: c.usage_limit, expiresAt, code: c.code,
  });
  dbx.markCodeRedeemed(c.code);

  return res.json({ token: signToken(user), user: publicUser(user) });
});

// Login com email + senha (no contexto de um produto).
app.post('/api/login', authLimiter, async (req, res) => {
  const { email, password, productSlug = 'rizzai' } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Preencha email e senha.' });
  const product = dbx.getProductBySlug(productSlug);
  if (!product) return res.status(400).json({ error: 'Produto inválido.' });

  const user = dbx.getUser(String(email).trim().toLowerCase(), product.id);
  if (!user) return res.status(401).json({ error: 'Email ou senha incorretos.' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email ou senha incorretos.' });

  return res.json({ token: signToken(user), user: publicUser(user) });
});

// Dados da conta logada.
app.get('/api/me', authRequired, (req, res) => res.json({ user: publicUser(req.user) }));

// ======================= GERAÇÃO COM IA =======================
app.post('/api/generate', generateLimiter, authRequired, async (req, res) => {
  const { image, mimeType, tone, goal, context, isStory } = req.body || {};
  if (!image || !mimeType) return res.status(400).json({ error: 'Imagem não fornecida.' });

  const user = req.user;
  // Checa limite de uso do plano.
  if (user.usage_limit !== null && user.usage_count >= user.usage_limit) {
    return res.status(403).json({ error: 'Você atingiu o limite de gerações do seu plano.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Servidor sem chave de IA configurada.' });

  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contextPrompt = context
    ? `\nINFORMAÇÃO ESPECÍFICA ADICIONAL SOBRE A GAROTA OU A SITUAÇÃO: "${context}".
Você deve OBRIGATORIAMENTE fundir e cruzar esta informação com a análise do print. As respostas devem fazer sentido combinando os dois dados. Por exemplo, se no contexto diz "ela estuda direito" e na imagem ela está na praia, brinque ou comente cruzando a praia e o estudo de direito de forma natural.`
    : '';

  const promptStory = `Você é um amigo ultra carismático especialista em "rizz" (sedução leve, humor inteligente e conversação moderna).
Analise a imagem enviada (print do story de uma garota).
Identifique cenário, roupas, pets, marcas, expressões, clima, maquiagem ou qualquer elemento visual claro.

Tom das mensagens: ${tone}.
Objetivo: ${goal}.${contextPrompt}

Gere exatamente 4 sugestões de respostas em português (Brasil) para enviar no direct reagindo a este story.
REGRAS CRÍTICAS DE ENGENHARIA DE PROMPT (OBRIGATÓRIO):
1. NUNCA faça elogios vazios, óbvios ou clichês (proibido usar palavras como 'linda', 'gata', 'maravilhosa', 'perfeita', 'princesa', 'gostosa').
2. As respostas devem se basear em DETALHES FÍSICOS REAIS identificados na foto. Se houver a Informação Específica acima, ela deve ser o foco principal ou secundário.
3. Escreva exatamente como um jovem brasileiro real digitaria no Instagram DM: use abreviações naturais (ex: vc, tb, c/, mto, pq, q), letras minúsculas, e tom descontraído.
4. No máximo 2 frases curtas por resposta. No máximo 1 emoji por resposta (apenas se soar muito natural).
5. Forneça para cada resposta uma tática curta de 1 frase explicando por que ela funciona.

Forneça o retorno estritamente no seguinte formato JSON (sem blocos de código markdown adicionais):
{
  "replies": [
    {
      "tag": "Estilo da mensagem",
      "text": "Texto da resposta para copiar",
      "tactic": "Breve explicação da tática"
    }
  ]
}`;

  const promptChat = `Você é um especialista em dinâmicas sociais e conversação por chat.
Analise a imagem enviada (print de tela de uma conversa no Tinder, WhatsApp ou Direct do Instagram).
Leia o histórico de mensagens e identifique exatamente a última mensagem enviada por ela, a vibe do papo e se ela está respondendo de forma engajada ou fria.

Com base nas configurações:
- Tom das mensagens: ${tone}.
- Objetivo das mensagens: ${goal}.${contextPrompt}

Gere exatamente 4 sugestões de respostas perfeitas em português (Brasil) para o usuário dar andamento a essa conversa ativa de forma certeira.
REGRAS CRÍTICAS:
1. As respostas devem responder DIRETAMENTE ao que ela mandou por último no print. Se houver a Informação Específica acima, incorpore-a de forma orgânica e inteligente.
2. Evite ser carente, bajulador ou chato. Mantenha o equilíbrio do carisma (soando confiante, com humor leve e maduro).
3. No máximo 2 frases por resposta. Maximo de 1 emoji por resposta.
4. Escreva no tom informal de conversa por celular, usando abreviações do dia a dia (vc, mto, pq).
5. Forneça para cada resposta uma tática curta de 1 frase.

Forneça o retorno estritamente no seguinte formato JSON (sem blocos de código markdown adicionais):
{
  "replies": [
    {
      "tag": "Estilo da mensagem (ex: Humor, Flertar, etc.)",
      "text": "Texto da resposta para copiar",
      "tactic": "Breve explicação da tática"
    }
  ]
}`;

  const finalPrompt = isStory ? promptStory : promptChat;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: finalPrompt }, { inlineData: { mimeType, data: image } }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Erro da API Gemini:', response.status, errText);
      return res.status(502).json({ error: 'Não foi possível gerar as respostas agora. Tente novamente.' });
    }

    const json = await response.json();
    const rawText = json.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawText.trim());

    // Sucesso: contabiliza uso e registra log.
    dbx.incrementUsage(user.id);
    dbx.addLog({ userId: user.id, productId: user.product_id, type: isStory ? 'Story' : 'Chat', tone, goal });

    return res.json(parsed);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Falha ao gerar respostas. Tente novamente.' });
  }
});

// ======================= ADMIN =======================
function adminAuth(req, res, next) {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword) {
    return res.status(503).json({ error: 'Painel admin desativado: defina ADMIN_PASSWORD no .env.' });
  }
  if (req.headers['x-admin-password'] === expectedPassword) return next();
  return res.status(403).json({ error: 'Acesso negado. Senha incorreta.' });
}

// Visão geral: códigos, usuários, logs e planos disponíveis.
app.get('/api/admin/data', authLimiter, adminAuth, (req, res) => {
  res.json({
    plans: Object.keys(dbx.PLANS),
    codes: dbx.listCodes(),
    users: dbx.listUsers(),
    logs: dbx.listLogs(100),
  });
});

// Gerar código para um produto + plano.
app.post('/api/admin/codes', authLimiter, adminAuth, (req, res) => {
  const { productSlug = 'rizzai', plan = 'pro', code } = req.body || {};
  const product = dbx.getProductBySlug(productSlug);
  if (!product) return res.status(400).json({ error: 'Produto inválido.' });
  if (!dbx.PLANS[plan]) return res.status(400).json({ error: 'Plano inválido.' });
  try {
    const created = dbx.createCode({ productId: product.id, plan, code });
    res.json({ success: true, code: created });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/admin/codes', authLimiter, adminAuth, (req, res) => {
  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Código inválido.' });
  dbx.deleteCode(code);
  res.json({ success: true });
});

// ======================= WEBHOOK CAKTO (esqueleto) =======================
// Mapa de oferta da Cakto -> { productSlug, plan }. Configure via env CAKTO_OFFER_MAP (JSON).
// Ex: CAKTO_OFFER_MAP={"oferta_id_starter":{"productSlug":"rizzai","plan":"starter"}}
let CAKTO_OFFER_MAP = {};
try { CAKTO_OFFER_MAP = JSON.parse(process.env.CAKTO_OFFER_MAP || '{}'); } catch { /* ignora */ }

app.post('/api/webhook/cakto', (req, res) => {
  // 1. Autenticação do webhook por segredo (?secret= ou header).
  const secret = process.env.CAKTO_WEBHOOK_SECRET;
  const provided = req.query.secret || req.headers['x-cakto-secret'];
  if (!secret || provided !== secret) return res.status(401).json({ error: 'unauthorized' });

  const body = req.body || {};
  // 2. Só gera código para pagamento aprovado. (Ajustar nomes conforme payload real da Cakto.)
  const status = body.status || body.event || body.payment_status;
  const approved = ['approved', 'paid', 'purchase_approved', 'completed'].includes(String(status).toLowerCase());
  if (!approved) return res.status(200).json({ ignored: true, reason: 'status não aprovado' });

  // 3. Identificador da transação (usado pela página de obrigado para buscar o código).
  const ref = String(
    body.transaction_id || body.order_id || body.checkout_id || body.id ||
    (body.transaction && body.transaction.id) || (body.data && body.data.id) || ''
  );

  // 4. Idempotência: se já geramos código para esta transação, devolve o mesmo.
  if (ref) {
    const existing = dbx.getCodeByRef(ref);
    if (existing) return res.status(200).json({ success: true, code: existing.code });
  }

  // 5. Descobre produto/plano pela oferta. Fallback configurável.
  const offerId = body.offer_id || body.product_id || (body.offer && body.offer.id) || '';
  const mapped = CAKTO_OFFER_MAP[offerId] || { productSlug: 'rizzai', plan: 'pro' };
  const product = dbx.getProductBySlug(mapped.productSlug);
  if (!product || !dbx.PLANS[mapped.plan]) {
    console.warn('Cakto webhook: mapeamento de oferta inválido para', offerId);
    return res.status(200).json({ ignored: true, reason: 'oferta não mapeada' });
  }

  // 6. Gera o código vinculado à transação.
  const created = dbx.createCode({ productId: product.id, plan: mapped.plan, source: 'cakto', externalRef: ref || null });
  console.log('💳 Cakto: código gerado', created.code, 'ref', ref, 'para', mapped);

  return res.status(200).json({ success: true, code: created.code });
});

// Página de obrigado consulta o código gerado para a transação (polling até o webhook chegar).
app.get('/api/order-code', authLimiter, (req, res) => {
  const ref = String(req.query.ref || '').trim();
  if (!ref) return res.status(400).json({ error: 'Referência não informada.' });
  const c = dbx.getCodeByRef(ref);
  if (!c) return res.status(404).json({ error: 'Código ainda não disponível.' });
  return res.json({ code: c.code, plan: c.plan, status: c.status });
});

app.listen(PORT, () => {
  console.log(`\n=============================================`);
  console.log(`🚀 Servidor RizzAI rodando na porta ${PORT}`);
  console.log(`👉 App: http://localhost:${PORT}/app.html`);
  console.log(`=============================================\n`);
});
