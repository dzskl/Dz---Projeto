const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');

// Atrás de um proxy reverso (nginx) na VPS, para que req.ip seja o IP real do cliente.
app.set('trust proxy', 1);

// CORS: restringe às origens definidas em ALLOWED_ORIGIN (separadas por vírgula).
// Se não definido, libera tudo (apenas para desenvolvimento).
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN.split(',').map(s => s.trim()) } : {}));

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter simples em memória (sem dependências externas).
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

const generateLimiter = rateLimiter({ windowMs: 60 * 1000, max: 30, message: 'Limite de gerações por minuto atingido. Aguarde um pouco.' });
const authLimiter = rateLimiter({ windowMs: 60 * 1000, max: 10, message: 'Muitas tentativas. Aguarde um minuto.' });

// Helper: ler banco
function readDb() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { accessCodes: [], usageCount: {}, logs: [] };
  }
}

// Helper: salvar banco
function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

// ROTA: Validar código de acesso do cliente
app.post('/api/validate-code', authLimiter, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Código não fornecido.' });
  
  const db = readDb();
  if (db.accessCodes.includes(code)) {
    return res.json({ success: true });
  } else {
    return res.status(401).json({ success: false, error: 'Código de acesso inválido.' });
  }
});

// ROTA: Gerar respostas com IA Real (escondendo a chave de API)
app.post('/api/generate', generateLimiter, async (req, res) => {
  const { code, image, mimeType, tone, goal, context, isStory } = req.body;

  // 0. Validação básica de entrada
  if (!image || !mimeType) {
    return res.status(400).json({ error: 'Imagem não fornecida.' });
  }

  // 1. Validar código
  const db = readDb();
  if (!db.accessCodes.includes(code)) {
    return res.status(401).json({ error: 'Código de acesso inválido ou expirado.' });
  }

  // 2. Incrementar contador de uso e registrar logs
  db.usageCount = db.usageCount || {};
  db.usageCount[code] = (db.usageCount[code] || 0) + 1;
  
  db.logs = db.logs || [];
  db.logs.push({
    timestamp: new Date().toLocaleString('pt-BR'),
    code,
    type: isStory ? 'Story' : 'Chat',
    tone,
    goal
  });
  writeDb(db);

  // 3. Obter chave de API
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Erro: Chave de API do Gemini não configurada no servidor (.env).' });
  }

  // 4. Montar chamada para o Gemini API
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Se o usuário digitou contexto extra, integra-o na instrução da IA
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
        contents: [{
          parts: [
            { text: finalPrompt },
            { inlineData: { mimeType: mimeType, data: image } }
          ]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Erro da API Gemini:', response.status, errText);
      return res.status(502).json({ error: 'Não foi possível gerar as respostas agora. Tente novamente em instantes.' });
    }

    const json = await response.json();
    const rawText = json.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(rawText.trim());
    return res.json(parsed);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: `Falha na requisição: ${err.message}` });
  }
});

// ── ROTAS DE ADMINISTRAÇÃO ──
function adminAuth(req, res, next) {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  // Fail-closed: sem senha configurada, o painel admin fica bloqueado.
  if (!expectedPassword) {
    return res.status(503).json({ error: 'Painel admin desativado: defina ADMIN_PASSWORD no arquivo .env.' });
  }
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword === expectedPassword) {
    next();
  } else {
    res.status(403).json({ error: 'Acesso negado. Senha incorreta.' });
  }
}

// Listar códigos e logs
app.get('/api/admin/codes', authLimiter, adminAuth, (req, res) => {
  const db = readDb();
  res.json({
    accessCodes: db.accessCodes || [],
    usageCount: db.usageCount || {},
    logs: db.logs || []
  });
});

// Criar código
app.post('/api/admin/codes', authLimiter, adminAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Código inválido.' });
  
  const db = readDb();
  db.accessCodes = db.accessCodes || [];
  if (!db.accessCodes.includes(code)) {
    db.accessCodes.push(code);
    writeDb(db);
  }
  res.json({ success: true, accessCodes: db.accessCodes });
});

// Remover código
app.delete('/api/admin/codes', authLimiter, adminAuth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Código inválido.' });

  const db = readDb();
  db.accessCodes = (db.accessCodes || []).filter(c => c !== code);
  writeDb(db);
  res.json({ success: true, accessCodes: db.accessCodes });
});

app.listen(PORT, () => {
  console.log(`\n=============================================`);
  console.log(`🚀 Servidor RizzAI rodando na porta ${PORT}`);
  console.log(`👉 Link do App: http://localhost:${PORT}`);
  console.log(`=============================================\n`);
});
