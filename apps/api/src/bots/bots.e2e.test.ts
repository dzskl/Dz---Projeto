import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { decryptSecret } from '@tg/config';
import { prisma } from '@tg/database';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { DomainExceptionFilter } from '../common/filters/domain-exception.filter';
import {
  ErroTelegram,
  TELEGRAM_API_FACTORY,
  type DadosDoBot,
  type InfoWebhook,
  type TelegramApi,
  type TelegramApiFactory,
} from '../telegram/telegram.types';

/**
 * Testes do cadastro de bots e do webhook.
 *
 * A Bot API e substituida por uma implementacao de mentira. Isso permite
 * exercitar os caminhos que seriam dificeis de provocar contra o Telegram real —
 * token recusado, falha ao registrar o webhook — de forma deterministica e sem
 * rede.
 */

const EMAIL = 'teste.bots@exemplo.com';
const SENHA = 'senha-de-teste-longa';
const TOKEN_VALIDO = '7891234567:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const TOKEN_RECUSADO = '1111111111:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ID_BOT_TELEGRAM = 7_891_234_567;

/** Registra o que a aplicacao pediu ao Telegram, para os testes conferirem. */
interface Chamadas {
  setWebhook: Array<{ url: string; secret: string }>;
  deleteWebhook: number;
}

let chamadas: Chamadas;
/** Quando ligado, setWebhook falha — simula indisponibilidade no cadastro. */
let falharSetWebhook = false;

class TelegramFalso implements TelegramApi {
  constructor(private readonly token: string) {}

  async getMe(): Promise<DadosDoBot> {
    if (this.token === TOKEN_RECUSADO) {
      throw new ErroTelegram('Token recusado pelo Telegram.', 401, true);
    }
    return {
      id: ID_BOT_TELEGRAM,
      username: 'bot_de_teste',
      firstName: 'Bot de Teste',
      isBot: true,
      canJoinGroups: true,
      canReadAllGroupMessages: false,
    };
  }

  async setWebhook(url: string, secretToken: string): Promise<void> {
    if (falharSetWebhook) {
      throw new ErroTelegram('Nao foi possivel falar com o Telegram.', undefined, false);
    }
    chamadas.setWebhook.push({ url, secret: secretToken });
  }

  async deleteWebhook(): Promise<void> {
    chamadas.deleteWebhook += 1;
  }

  async getWebhookInfo(): Promise<InfoWebhook> {
    return { url: '', pendingUpdateCount: 0 };
  }
}

const fabricaFalsa: TelegramApiFactory = {
  create: (token: string) => new TelegramFalso(token),
};

let app: INestApplication;
let agente: ReturnType<typeof request.agent>;

async function limparBots(): Promise<void> {
  await prisma.telegramUpdate.deleteMany({});
  await prisma.bot.deleteMany({ where: { telegramBotId: BigInt(ID_BOT_TELEGRAM) } });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TELEGRAM_API_FACTORY)
    .useValue(fabricaFalsa)
    .compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.setGlobalPrefix('api');
  await app.init();

  await prisma.admin.deleteMany({ where: { email: EMAIL } });
  await prisma.admin.create({
    data: {
      email: EMAIL,
      name: 'Teste',
      role: 'OWNER',
      passwordHash: await hash(SENHA, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    },
  });

  agente = request.agent(app.getHttpServer());
  await agente.post('/api/auth/login').send({ email: EMAIL, password: SENHA }).expect(200);
});

beforeEach(async () => {
  chamadas = { setWebhook: [], deleteWebhook: 0 };
  falharSetWebhook = false;
  await limparBots();
});

afterAll(async () => {
  await limparBots();
  await prisma.admin.deleteMany({ where: { email: EMAIL } });
  await app.close();
  await prisma.$disconnect();
});

describe('cadastro de bot', () => {
  it('exige autenticacao', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/bots')
      .send({ token: TOKEN_VALIDO });
    expect(res.status).toBe(401);
  });

  it('recusa token com formato invalido antes de chamar o Telegram', async () => {
    const res = await agente.post('/api/bots').send({ token: 'isso-nao-e-um-token' });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields).toHaveProperty('token');
    // Nenhuma chamada de rede deve ter acontecido.
    expect(chamadas.setWebhook).toHaveLength(0);
  });

  it('cadastra, cifra o token e registra o webhook', async () => {
    const res = await agente.post('/api/bots').send({ token: TOKEN_VALIDO });

    expect(res.status).toBe(201);
    expect(res.body.bot.username).toBe('bot_de_teste');
    expect(res.body.bot.status).toBe('CONNECTED');

    // A resposta nunca pode conter o token, nem inteiro nem cifrado.
    const corpo = JSON.stringify(res.body);
    expect(corpo).not.toContain(TOKEN_VALIDO);
    expect(corpo).not.toContain('AAHdqTcv');
    expect(res.body.bot.tokenHint).toBe('Dsaw');

    // No banco o token esta cifrado, mas continua recuperavel.
    const salvo = await prisma.bot.findUniqueOrThrow({
      where: { telegramBotId: BigInt(ID_BOT_TELEGRAM) },
    });
    expect(salvo.tokenEncrypted).not.toContain(TOKEN_VALIDO);
    expect(decryptSecret(salvo.tokenEncrypted)).toBe(TOKEN_VALIDO);

    // O webhook aponta para este bot e usa o segredo gravado.
    expect(chamadas.setWebhook).toHaveLength(1);
    expect(chamadas.setWebhook[0]?.url).toContain(`/api/telegram/webhook/${salvo.id}`);
    expect(chamadas.setWebhook[0]?.secret).toBe(salvo.webhookSecret);
  });

  it('devolve erro de campo quando o Telegram recusa o token', async () => {
    const res = await agente.post('/api/bots').send({ token: TOKEN_RECUSADO });
    expect(res.status).toBe(422);
    expect(res.body.error.details.fields.token).toBeDefined();
    // Nada pode ter sido gravado.
    expect(await prisma.bot.count()).toBe(0);
  });

  it('recusa cadastrar o mesmo bot duas vezes', async () => {
    await agente.post('/api/bots').send({ token: TOKEN_VALIDO }).expect(201);
    const res = await agente.post('/api/bots').send({ token: TOKEN_VALIDO });
    expect(res.status).toBe(409);
  });

  it('mantem o bot salvo com status ERROR se o webhook falhar', async () => {
    // O token ja foi validado; desfazer obrigaria a recadastrar sem necessidade.
    falharSetWebhook = true;
    const res = await agente.post('/api/bots').send({ token: TOKEN_VALIDO });

    expect(res.status).toBe(201);
    expect(res.body.bot.status).toBe('ERROR');
    expect(res.body.bot.lastError).toBeTruthy();
    expect(await prisma.bot.count()).toBe(1);
  });
});

describe('reconectar', () => {
  it('volta o bot para CONNECTED e limpa o erro', async () => {
    falharSetWebhook = true;
    const criado = await agente.post('/api/bots').send({ token: TOKEN_VALIDO });
    expect(criado.body.bot.status).toBe('ERROR');

    falharSetWebhook = false;
    const res = await agente.post(`/api/bots/${criado.body.bot.id}/reconectar`);

    expect(res.status).toBe(200);
    expect(res.body.bot.status).toBe('CONNECTED');
    expect(res.body.bot.lastError).toBeNull();
  });
});

describe('exclusao', () => {
  it('remove o webhook antes de apagar', async () => {
    const criado = await agente.post('/api/bots').send({ token: TOKEN_VALIDO }).expect(201);

    await agente.delete(`/api/bots/${criado.body.bot.id}`).expect(204);

    expect(chamadas.deleteWebhook).toBe(1);
    expect(await prisma.bot.count()).toBe(0);
  });
});

describe('webhook', () => {
  let botId: string;
  let segredo: string;

  beforeEach(async () => {
    const criado = await agente.post('/api/bots').send({ token: TOKEN_VALIDO }).expect(201);
    botId = criado.body.bot.id;
    const salvo = await prisma.bot.findUniqueOrThrow({ where: { id: botId } });
    segredo = salvo.webhookSecret;
  });

  const update = (id: number): Record<string, unknown> => ({
    update_id: id,
    message: { message_id: 1, text: '/start', chat: { id: 123, type: 'private' } },
  });

  it('grava o update quando o segredo confere', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/telegram/webhook/${botId}`)
      .set('x-telegram-bot-api-secret-token', segredo)
      .send(update(1001));

    expect(res.status).toBe(200);
    const salvo = await prisma.telegramUpdate.findFirst({ where: { botId } });
    expect(salvo?.updateId).toBe(1001n);
    expect(salvo?.type).toBe('message');
  });

  it('descarta update sem o segredo, respondendo 200', async () => {
    // 200 de proposito: 401 faria o Telegram reenviar para sempre e ainda
    // serviria de oraculo para descobrir ids de bot validos.
    const res = await request(app.getHttpServer())
      .post(`/api/telegram/webhook/${botId}`)
      .send(update(1002));

    expect(res.status).toBe(200);
    expect(await prisma.telegramUpdate.count({ where: { botId } })).toBe(0);
  });

  it('descarta update com segredo errado', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/telegram/webhook/${botId}`)
      .set('x-telegram-bot-api-secret-token', 'segredo-errado-mas-do-mesmo-tamanho')
      .send(update(1003));

    expect(res.status).toBe(200);
    expect(await prisma.telegramUpdate.count({ where: { botId } })).toBe(0);
  });

  it('responde 200 para bot inexistente sem revelar nada', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/telegram/webhook/00000000-0000-0000-0000-000000000000')
      .set('x-telegram-bot-api-secret-token', segredo)
      .send(update(1004));
    expect(res.status).toBe(200);
  });

  it('e idempotente: reentrega do mesmo update nao duplica', async () => {
    const enviar = (): request.Test =>
      request(app.getHttpServer())
        .post(`/api/telegram/webhook/${botId}`)
        .set('x-telegram-bot-api-secret-token', segredo)
        .send(update(2001));

    await enviar().expect(200);
    await enviar().expect(200);
    await enviar().expect(200);

    expect(await prisma.telegramUpdate.count({ where: { botId, updateId: 2001n } })).toBe(1);
  });

  it('aguenta entregas simultaneas do mesmo update', async () => {
    // O Telegram pode reentregar antes de a primeira gravacao terminar; e o
    // unico (bot_id, update_id) que impede a duplicata, nao a logica.
    const enviar = (): request.Test =>
      request(app.getHttpServer())
        .post(`/api/telegram/webhook/${botId}`)
        .set('x-telegram-bot-api-secret-token', segredo)
        .send(update(3001));

    const respostas = await Promise.all([enviar(), enviar(), enviar(), enviar(), enviar()]);
    for (const r of respostas) expect(r.status).toBe(200);

    expect(await prisma.telegramUpdate.count({ where: { botId, updateId: 3001n } })).toBe(1);
  });

  it('nao grava update de bot desativado', async () => {
    await agente.patch(`/api/bots/${botId}`).send({ isActive: false }).expect(200);

    await request(app.getHttpServer())
      .post(`/api/telegram/webhook/${botId}`)
      .set('x-telegram-bot-api-secret-token', segredo)
      .send(update(4001))
      .expect(200);

    expect(await prisma.telegramUpdate.count({ where: { botId } })).toBe(0);
  });

  it('classifica o tipo do update', async () => {
    await request(app.getHttpServer())
      .post(`/api/telegram/webhook/${botId}`)
      .set('x-telegram-bot-api-secret-token', segredo)
      .send({ update_id: 5001, my_chat_member: { chat: { id: 1, type: 'group' } } })
      .expect(200);

    const salvo = await prisma.telegramUpdate.findFirst({
      where: { botId, updateId: 5001n },
    });
    expect(salvo?.type).toBe('my_chat_member');
  });
});
