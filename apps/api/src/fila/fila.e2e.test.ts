import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { encryptSecret } from '@tg/config';
import { prisma } from '@tg/database';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { DomainExceptionFilter } from '../common/filters/domain-exception.filter';
import {
  TELEGRAM_API_FACTORY,
  type BotaoInline,
  type DadosDoBot,
  type InfoWebhook,
  type TelegramApi,
  type TelegramApiFactory,
} from '../telegram/telegram.types';
import { EnvioService } from './envio.service';
import { encerrarFilas, filaDoBot } from './fila';

/**
 * Teste da fila de verdade.
 *
 * Os demais testes chamam o worker diretamente, o que isola a logica de envio.
 * Este aqui passa pelo Redis: enfileira, deixa o Worker do BullMQ consumir e
 * confere o resultado. E o que prova que o encanamento (nome da fila, jobId,
 * limitador, conexao) esta certo — coisas que um teste com chamada direta nao
 * exercita.
 */

const EMAIL = 'teste.fila@exemplo.com';
const SENHA = 'senha-de-teste-longa';
const TOKEN = '7891234567:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ID_BOT = 7_891_234_999;

let enviadas: string[] = [];

class TelegramFalso implements TelegramApi {
  async getMe(): Promise<DadosDoBot> {
    return {
      id: ID_BOT,
      username: 'bot_fila',
      firstName: 'Bot',
      isBot: true,
      canJoinGroups: true,
      canReadAllGroupMessages: false,
    };
  }
  async sendMessage(chatId: number | bigint, _texto: string, _botoes?: BotaoInline[]): Promise<number> {
    enviadas.push(chatId.toString());
    return enviadas.length;
  }
  async setWebhook(): Promise<void> {}
  async deleteWebhook(): Promise<void> {}
  async getWebhookInfo(): Promise<InfoWebhook> {
    return { url: '', pendingUpdateCount: 0 };
  }
}

let app: INestApplication;
let agente: ReturnType<typeof request.agent>;
let envio: EnvioService;
let botId: string;

async function limpar(): Promise<void> {
  await prisma.sendLog.deleteMany({});
  await prisma.campaignRecipient.deleteMany({});
  await prisma.campaignMessage.deleteMany({});
  await prisma.campaign.deleteMany({});
  await prisma.optOut.deleteMany({});
  await prisma.botUser.deleteMany({});
  await prisma.telegramUser.deleteMany({});
  await prisma.bot.deleteMany({});
}

/** Espera uma condicao acontecer, com limite de tempo. */
async function aguardar(condicao: () => Promise<boolean>, limiteMs = 15_000): Promise<void> {
  const fim = Date.now() + limiteMs;
  while (Date.now() < fim) {
    if (await condicao()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('condicao nao aconteceu dentro do tempo');
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TELEGRAM_API_FACTORY)
    .useValue({ create: () => new TelegramFalso() } satisfies TelegramApiFactory)
    .compile();

  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.setGlobalPrefix('api');
  await app.init();
  envio = app.get(EnvioService);

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
  enviadas = [];
  await limpar();
  const bot = await prisma.bot.create({
    data: {
      telegramBotId: BigInt(ID_BOT),
      username: 'bot_fila',
      name: 'Bot',
      tokenEncrypted: encryptSecret(TOKEN),
      tokenHint: 'Dsaw',
      webhookSecret: 'segredo',
      status: 'CONNECTED',
      isActive: true,
      ratePerSecond: 20,
    },
  });
  botId = bot.id;
  await filaDoBot(botId).obliterate({ force: true }).catch(() => undefined);
});

afterAll(async () => {
  await limpar();
  await prisma.admin.deleteMany({ where: { email: EMAIL } });
  await app.close();
  await encerrarFilas();
  await prisma.$disconnect();
});

describe('fila real', () => {
  it('entrega pela fila do Redis e conclui a campanha', async () => {
    const total = 6;
    for (let i = 0; i < total; i++) {
      const tgId = BigInt(80_000 + i);
      const pessoa = await prisma.telegramUser.create({
        data: { telegramUserId: tgId, firstName: `P${i}` },
      });
      await prisma.botUser.create({
        data: {
          botId,
          telegramUserId: pessoa.id,
          privateChatId: tgId,
          status: 'ACTIVE',
          consentSource: 'START_COMMAND',
          consentAt: new Date(),
        },
      });
    }

    const criada = await agente
      .post('/api/campanhas')
      .send({
        nome: 'Pela fila',
        botId,
        mensagens: [{ kind: 'TEXT', texto: 'Ola' }],
        ratePerSecond: 20,
      })
      .expect(201);
    const campanhaId = criada.body.campanha.id as string;

    // Sobe o worker ANTES de iniciar, para nao perder jobs.
    envio.garantirWorker(botId, 20);

    await agente.post(`/api/campanhas/${campanhaId}/iniciar`).expect(200);

    await aguardar(async () => {
      const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campanhaId } });
      return c.status === 'COMPLETED';
    });

    expect(enviadas).toHaveLength(total);
    const campanha = await prisma.campaign.findUniqueOrThrow({ where: { id: campanhaId } });
    expect(campanha.sentCount).toBe(total);
    expect(campanha.totalRecipients).toBe(total);
  });

  it('usa o id do destinatario como jobId, impedindo duplicata na fila', async () => {
    const tgId = 81_000n;
    const pessoa = await prisma.telegramUser.create({
      data: { telegramUserId: tgId, firstName: 'Unico' },
    });
    await prisma.botUser.create({
      data: {
        botId,
        telegramUserId: pessoa.id,
        privateChatId: tgId,
        status: 'ACTIVE',
        consentSource: 'START_COMMAND',
        consentAt: new Date(),
      },
    });

    const criada = await agente
      .post('/api/campanhas')
      .send({ nome: 'Duplicata', botId, mensagens: [{ kind: 'TEXT', texto: 'Ola' }] })
      .expect(201);
    const campanhaId = criada.body.campanha.id as string;

    await agente.post(`/api/campanhas/${campanhaId}/iniciar`).expect(200);

    const destinatario = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId: campanhaId },
    });
    const fila = filaDoBot(botId);

    // Tentar enfileirar o mesmo jobId de novo: o BullMQ ignora.
    await fila.add(
      'enviar',
      { campanhaId, destinatarioId: destinatario.id, botId },
      { jobId: destinatario.id },
    );

    const aguardando = await fila.getWaitingCount();
    expect(aguardando).toBe(1);
  });
});
