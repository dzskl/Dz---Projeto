import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, prisma } from './index.js';

/**
 * Testes das garantias de integridade que o banco precisa oferecer.
 *
 * Sao as regras que nao podem depender da logica da aplicacao: mesmo com bug,
 * corrida entre workers ou reprocessamento, o banco tem que recusar.
 *
 * Exige um PostgreSQL 15+ acessivel em DATABASE_URL.
 */

const UNIQUE_VIOLATION = 'P2002';

/** Prefixo alto e improvavel, para nao colidir com dados reais. */
const TEST_TG_ID = 987_650_000_000n;

let botId: string;
let telegramUserId: string;
let botUserId: string;
let campaignId: string;

beforeAll(async () => {
  const bot = await prisma.bot.create({
    data: {
      telegramBotId: TEST_TG_ID + 1n,
      username: 'bot_de_teste',
      name: 'Bot de Teste',
      tokenEncrypted: 'cifrado',
      tokenHint: '4321',
      webhookSecret: 'segredo-de-teste',
    },
  });
  botId = bot.id;

  const tgUser = await prisma.telegramUser.create({
    data: { telegramUserId: TEST_TG_ID + 2n, firstName: 'Teste' },
  });
  telegramUserId = tgUser.id;

  const botUser = await prisma.botUser.create({
    data: {
      botId,
      telegramUserId,
      privateChatId: TEST_TG_ID + 2n,
      consentSource: 'START_COMMAND',
      consentAt: new Date(),
    },
  });
  botUserId = botUser.id;

  const campaign = await prisma.campaign.create({
    data: { name: 'Campanha de Teste', botId },
  });
  campaignId = campaign.id;
});

afterAll(async () => {
  // Cascata cuida dos filhos; basta remover as raizes.
  await prisma.campaign.deleteMany({ where: { botId } });
  await prisma.bot.deleteMany({ where: { id: botId } });
  await prisma.telegramUser.deleteMany({ where: { id: telegramUserId } });
  await prisma.$disconnect();
});

describe('nao duplicacao de envio', () => {
  it('recusa o mesmo destinatario duas vezes na mesma campanha', async () => {
    await prisma.campaignRecipient.create({ data: { campaignId, botUserId } });

    await expect(
      prisma.campaignRecipient.create({ data: { campaignId, botUserId } }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

    const total = await prisma.campaignRecipient.count({ where: { campaignId } });
    expect(total).toBe(1);
  });

  it('permite o mesmo destinatario em campanhas diferentes', async () => {
    const outra = await prisma.campaign.create({ data: { name: 'Outra', botId } });
    const criado = await prisma.campaignRecipient.create({
      data: { campaignId: outra.id, botUserId },
    });
    expect(criado.id).toBeTruthy();
  });
});

describe('idempotencia do webhook', () => {
  it('recusa o mesmo update_id duas vezes para o mesmo bot', async () => {
    const updateId = 555_001n;
    const payload: Prisma.InputJsonValue = { update_id: 555_001, message: { text: '/start' } };

    await prisma.telegramUpdate.create({
      data: { botId, updateId, type: 'message', payload },
    });

    await expect(
      prisma.telegramUpdate.create({ data: { botId, updateId, type: 'message', payload } }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });
});

describe('opt-out', () => {
  it('recusa dois opt-outs globais para a mesma pessoa', async () => {
    // Regressao: bot_id e nulo no opt-out global e, por padrao, o PostgreSQL
    // trata NULL como distinto de NULL — o que permitia duplicar. Corrigido com
    // NULLS NOT DISTINCT na migration 20260820235600.
    await prisma.optOut.create({
      data: { botId: null, telegramUserId, reason: 'USER_REQUEST' },
    });

    await expect(
      prisma.optOut.create({ data: { botId: null, telegramUserId, reason: 'MANUAL' } }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });

    const total = await prisma.optOut.count({ where: { telegramUserId, botId: null } });
    expect(total).toBe(1);
  });

  it('permite opt-out global e opt-out por bot para a mesma pessoa', async () => {
    // Sao registros com significados diferentes e devem coexistir.
    const porBot = await prisma.optOut.create({
      data: { botId, telegramUserId, reason: 'BLOCKED_BOT' },
    });
    expect(porBot.botId).toBe(botId);
  });
});

describe('vinculo pessoa x bot', () => {
  it('recusa o mesmo usuario duas vezes no mesmo bot', async () => {
    await expect(
      prisma.botUser.create({
        data: { botId, telegramUserId, consentSource: 'MANUAL', consentAt: new Date() },
      }),
    ).rejects.toMatchObject({ code: UNIQUE_VIOLATION });
  });
});
