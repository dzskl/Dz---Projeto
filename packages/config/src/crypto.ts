import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { getEnv } from './env.js';

/**
 * Cifragem de segredos em repouso (AES-256-GCM).
 *
 * Usada para os tokens de bot: quem tem o token controla o bot por inteiro, entao
 * ele nunca pode ficar legivel no banco. Um dump do PostgreSQL sozinho nao basta
 * para assumir os bots — e preciso tambem a ENCRYPTION_KEY, que fica no Secret
 * Manager.
 *
 * Mora em @tg/config porque a chave vem do ambiente e tanto a API (que cifra ao
 * cadastrar) quanto o worker (que decifra para enviar) dependem deste pacote.
 *
 * GCM e escolhido em vez de CBC por ser cifragem autenticada: alem de esconder o
 * conteudo, detecta adulteracao. Sem isso, quem tivesse acesso de escrita ao
 * banco poderia trocar bytes do texto cifrado sem que a decifragem reclamasse.
 */

const ALGORITMO = 'aes-256-gcm';
/** 96 bits e o tamanho de nonce recomendado para GCM. */
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

function chave(): Buffer {
  return Buffer.from(getEnv().ENCRYPTION_KEY, 'hex');
}

/**
 * Cifra um segredo.
 *
 * Formato: iv.tag.conteudo (base64url, separados por ponto). O IV e aleatorio a
 * cada chamada, entao cifrar o mesmo token duas vezes produz saidas diferentes —
 * o que impede deduzir, olhando o banco, que dois bots usam o mesmo token.
 */
export function encryptSecret(textoPuro: string): string {
  const iv = randomBytes(TAMANHO_IV);
  const cipher = createCipheriv(ALGORITMO, chave(), iv);

  const conteudo = Buffer.concat([cipher.update(textoPuro, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString('base64url'), tag.toString('base64url'), conteudo.toString('base64url')].join(
    '.',
  );
}

/**
 * Decifra um segredo.
 *
 * Lanca se o valor tiver sido adulterado ou se a chave estiver errada — nunca
 * devolve lixo silenciosamente.
 */
export function decryptSecret(cifrado: string): string {
  const partes = cifrado.split('.');
  if (partes.length !== 3) {
    throw new Error('Segredo cifrado em formato invalido.');
  }

  const [ivB64, tagB64, conteudoB64] = partes as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const conteudo = Buffer.from(conteudoB64, 'base64url');

  if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) {
    throw new Error('Segredo cifrado em formato invalido.');
  }

  const decipher = createDecipheriv(ALGORITMO, chave(), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(conteudo), decipher.final()]).toString('utf8');
  } catch {
    // A mensagem do OpenSSL nao ajuda quem le o log e pode variar entre versoes.
    throw new Error('Nao foi possivel decifrar o segredo: chave incorreta ou dado adulterado.');
  }
}

/**
 * Ultimos 4 caracteres do segredo, para exibicao.
 *
 * Permite ao administrador reconhecer qual token esta cadastrado sem que a API
 * precise devolver o valor completo em nenhum momento.
 */
export function secretHint(textoPuro: string): string {
  return textoPuro.slice(-4);
}

/**
 * Comparacao em tempo constante.
 *
 * Usada para conferir o secret_token que o Telegram envia no cabecalho do
 * webhook: com `===`, o tempo de resposta varia conforme quantos caracteres
 * iniciais batem, o que permite descobrir o segredo tentativa a tentativa.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual exige o mesmo tamanho; comparar o tamanho antes ja vaza
  // essa informacao, mas o tamanho do segredo nao e o que o protege.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Gera o secret_token do webhook.
 *
 * O Telegram aceita de 1 a 256 caracteres em A-Z, a-z, 0-9, _ e - — base64url
 * usa exatamente esse alfabeto.
 */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url');
}
