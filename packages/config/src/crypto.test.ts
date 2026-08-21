import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  safeCompare,
  secretHint,
} from './crypto.js';
import { resetEnvCache } from './env.js';

/**
 * Testes da cifragem de segredos.
 *
 * O que se garante aqui e o que protege os tokens de bot: o valor nao aparece em
 * claro, adulteracao e detectada e a mesma entrada nao produz sempre a mesma
 * saida.
 */

// Token no formato real do Telegram, para o teste exercitar o tamanho de dado
// que sera usado em producao.
const TOKEN = '7891234567:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.DATABASE_URL = 'postgresql://x@localhost:5432/x';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.SESSION_SECRET = 's'.repeat(48);
});

describe('encryptSecret / decryptSecret', () => {
  it('devolve o valor original apos cifrar e decifrar', () => {
    expect(decryptSecret(encryptSecret(TOKEN))).toBe(TOKEN);
  });

  it('nao deixa o token aparecer no texto cifrado', () => {
    const cifrado = encryptSecret(TOKEN);
    expect(cifrado).not.toContain(TOKEN);
    // Nem mesmo o prefixo numerico, que e a parte publica do token.
    expect(cifrado).not.toContain('7891234567');
  });

  it('produz saidas diferentes para a mesma entrada', () => {
    // IV aleatorio por chamada: olhando o banco nao da para saber que dois bots
    // usam o mesmo token.
    expect(encryptSecret(TOKEN)).not.toBe(encryptSecret(TOKEN));
  });

  it('preserva acentos e emoji', () => {
    const texto = 'joao@exemplo.com — acao \u{1F680}';
    expect(decryptSecret(encryptSecret(texto))).toBe(texto);
  });

  it('funciona com string vazia', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });
});

describe('deteccao de adulteracao', () => {
  it('recusa conteudo alterado', () => {
    const [iv, tag, conteudo] = encryptSecret(TOKEN).split('.') as [string, string, string];
    // Troca o primeiro caractere do conteudo por outro do mesmo alfabeto.
    const alterado = (conteudo[0] === 'A' ? 'B' : 'A') + conteudo.slice(1);
    expect(() => decryptSecret([iv, tag, alterado].join('.'))).toThrow(/decifrar/);
  });

  it('recusa tag de autenticacao alterada', () => {
    const [iv, tag, conteudo] = encryptSecret(TOKEN).split('.') as [string, string, string];
    const alterada = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(() => decryptSecret([iv, alterada, conteudo].join('.'))).toThrow(/decifrar/);
  });

  it('recusa formato invalido', () => {
    expect(() => decryptSecret('nao-e-cifrado')).toThrow(/formato invalido/);
    expect(() => decryptSecret('a.b')).toThrow(/formato invalido/);
  });

  it('recusa IV de tamanho errado', () => {
    const [, tag, conteudo] = encryptSecret(TOKEN).split('.') as [string, string, string];
    expect(() => decryptSecret(['curto', tag, conteudo].join('.'))).toThrow(/formato invalido/);
  });

  it('recusa quando a chave e outra', () => {
    const cifrado = encryptSecret(TOKEN);
    const original = process.env.ENCRYPTION_KEY;
    try {
      process.env.ENCRYPTION_KEY = 'b'.repeat(64);
      // getEnv cacheia; forcar releitura simula um processo com outra chave.
      resetEnvCache();
      expect(() => decryptSecret(cifrado)).toThrow(/decifrar/);
    } finally {
      process.env.ENCRYPTION_KEY = original;
      resetEnvCache();
    }
  });
});

describe('secretHint', () => {
  it('devolve apenas os quatro ultimos caracteres', () => {
    expect(secretHint(TOKEN)).toBe('Dsaw');
    expect(secretHint(TOKEN)).toHaveLength(4);
  });
});

describe('safeCompare', () => {
  it('aceita valores iguais', () => {
    expect(safeCompare('segredo-abc', 'segredo-abc')).toBe(true);
  });

  it('recusa valores diferentes', () => {
    expect(safeCompare('segredo-abc', 'segredo-abd')).toBe(false);
  });

  it('recusa tamanhos diferentes sem lancar', () => {
    // timingSafeEqual lanca se os buffers tiverem tamanhos distintos; a funcao
    // precisa tratar isso e devolver false.
    expect(safeCompare('curto', 'bem-mais-longo')).toBe(false);
  });
});

describe('generateWebhookSecret', () => {
  it('usa apenas os caracteres aceitos pelo Telegram', () => {
    // O Telegram limita o secret_token a A-Z, a-z, 0-9, _ e -.
    for (let i = 0; i < 20; i++) {
      expect(generateWebhookSecret()).toMatch(/^[A-Za-z0-9_-]{1,256}$/);
    }
  });

  it('nao repete', () => {
    const gerados = new Set(Array.from({ length: 50 }, () => generateWebhookSecret()));
    expect(gerados.size).toBe(50);
  });
});
