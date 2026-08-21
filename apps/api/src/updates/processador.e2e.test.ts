import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { encryptSecret } from '@tg/config';
import { prisma } from '@tg/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import {
  ErroTelegram,
  TELEGRAM_API_FACTORY,
  type DadosDoBot,
  type InfoWebhook,
  type TelegramApi,
  type TelegramApiFactory,
} from '../telegram/telegram.types';
import { UpdateProcessorService } from './update-processor.service';
import { UpdatesService } from './updates.service';

/**
 * Testes do processamento de updates.
 *
 * Cobrem a traducao de "chegou um update" para consentimento, opt-out e presenca
 * em grupo. O envio de mensagens falha de proposito em alguns casos, para provar
 * que a gravacao nao depende de o Telegram estar acessivel.
 */

const TOKEN = '7891234567:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ID_BOT = 7_891_234_567;
const ID_PESSOA = 555_000_111;
const CHAT_PRIVADO = 555_000_111;
const ID_GRUPO = -1_001_234_567_890;

let enviadas: Array<{ chatId: string; texto: string }> = [];
let falharEnvio = false;

class TelegramFalso implements TelegramApi {
  async getMe(): Promise<DadosDoBot> {
    return {
      id: ID_BOT,
      username: 'bot_de_teste',
      firstName: 'Bot',
      isBot: true,
      canJoinGroups: true,
      canReadAllGroupMessages: false,
    };
  }
  async sendMessage(chatId: number | bigint, texto: string): Promise<number> {
    if (falharEnvio) {
      throw new ErroTelegram('bot was blocked by the user', 403, false, true);
    }
    enviadas.push({ chatId: chatId.toString(), texto });
    return 1;
  }
  async setWebhook(): Promise<void> {}
  async deleteWebhook(): Promise<void> {}
  async getWebhookInfo(): Promise<InfoWebhook> {
    return { url: '', pendingUpdateCount: 0 };
  }
}

const fabricaFalsa: TelegramApiFactory = { create: () => new TelegramFalso() };

let app: INestApplication;
let processador: UpdateProcessorService;
let updates: UpdatesService;
let botId: string;

/** Grava um update como o webhook faria e o processa. */
async function receber(tipo: string, corpo: Record<string, unknown>, id = Date.now()): Promise<void> {
  const registro = await prisma.telegramUpdate.create({
    data: {
      botId,
      updateId: BigInt(id),
      type: tipo,
      payload: { update_id: id, [tipo]: corpo },
    },
  });
  await processador.processar(registro);
}

const pessoa = {
  id: ID_PESSOA,
  is_bot: false,
  first_name: 'Maria',
  last_name: 'Silva',
  username: 'maria_silva',
  language_code: 'pt-br',
};

const mensagemPrivada = (texto: string): Record<string, unknown> => ({
  message_id: 1,
  from: pessoa,
  chat: { id: CHAT_PRIVADO, type: 'private' },
  text: texto,
});

async function vinculo() {
  const p = await prisma.telegramUser.findUnique({
    where: { telegramUserId: BigInt(ID_PESSOA) },
  });
  if (!p) return null;
  return prisma.botUser.findUnique({
    where: { botId_telegramUserId: { botId, telegramUserId: p.id } },
  });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(TELEGRAM_API_FACTORY)
    .useValue(fabricaFalsa)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();

  processador = app.get(UpdateProcessorService);
  updates = app.get(UpdatesService);
});

beforeEach(async () => {
  enviadas = [];
  falharEnvio = false;

  await prisma.telegramUpdate.deleteMany({});
  await prisma.optOut.deleteMany({});
  await prisma.botUser.deleteMany({});
  await prisma.chat.deleteMany({});
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: BigInt(ID_PESSOA) } });
  await prisma.bot.deleteMany({ where: { telegramBotId: BigInt(ID_BOT) } });

  const bot = await prisma.bot.create({
    data: {
      telegramBotId: BigInt(ID_BOT),
      username: 'bot_de_teste',
      name: 'Bot',
      tokenEncrypted: encryptSecret(TOKEN),
      tokenHint: 'Dsaw',
      webhookSecret: 'segredo',
    },
  });
  botId = bot.id;
});

afterAll(async () => {
  await prisma.telegramUpdate.deleteMany({});
  await prisma.optOut.deleteMany({});
  await prisma.botUser.deleteMany({});
  await prisma.chat.deleteMany({});
  await prisma.telegramUser.deleteMany({ where: { telegramUserId: BigInt(ID_PESSOA) } });
  await prisma.bot.deleteMany({ where: { telegramBotId: BigInt(ID_BOT) } });
  await app.close();
  await prisma.$disconnect();
});

describe('/start', () => {
  it('cria o contato com consentimento registrado', async () => {
    await receber('message', mensagemPrivada('/start'), 1);

    const v = await vinculo();
    expect(v?.status).toBe('ACTIVE');
    expect(v?.consentSource).toBe('START_COMMAND');
    expect(v?.privateChatId).toBe(BigInt(CHAT_PRIVADO));
    expect(v?.consentAt).toBeInstanceOf(Date);

    const p = await prisma.telegramUser.findUniqueOrThrow({
      where: { telegramUserId: BigInt(ID_PESSOA) },
    });
    expect(p.username).toBe('maria_silva');
  });

  it('guarda o parametro do deep link como origem', async () => {
    // t.me/bot?start=campanha_natal chega como "/start campanha_natal".
    await receber('message', mensagemPrivada('/start campanha_natal'), 2);
    expect((await vinculo())?.consentPayload).toBe('campanha_natal');
  });

  it('confirma para a pessoa', async () => {
    await receber('message', mensagemPrivada('/start'), 3);
    expect(enviadas).toHaveLength(1);
    expect(enviadas[0]?.texto).toContain('/stop');
  });

  it('grava o contato mesmo se a confirmacao falhar', async () => {
    // O dado importa mais que o aviso: nao conseguir responder nao pode
    // impedir o registro do consentimento.
    falharEnvio = true;
    await receber('message', mensagemPrivada('/start'), 4);
    expect((await vinculo())?.status).toBe('ACTIVE');
    expect(enviadas).toHaveLength(0);
  });

  it('e idempotente: reprocessar nao muda o resultado', async () => {
    const registro = await prisma.telegramUpdate.create({
      data: {
        botId,
        updateId: 10n,
        type: 'message',
        payload: { update_id: 10, message: mensagemPrivada('/start') },
      },
    });
    await processador.processar(registro);
    const primeiro = await vinculo();

    await processador.processar(registro);
    const segundo = await vinculo();

    expect(segundo?.id).toBe(primeiro?.id);
    expect(await prisma.botUser.count({ where: { botId } })).toBe(1);
  });
});

describe('/stop', () => {
  it('marca a saida e cria o opt-out', async () => {
    await receber('message', mensagemPrivada('/start'), 20);
    await receber('message', mensagemPrivada('/stop'), 21);

    const v = await vinculo();
    expect(v?.status).toBe('UNSUBSCRIBED');

    const opt = await prisma.optOut.findFirst({ where: { botId } });
    expect(opt?.reason).toBe('USER_REQUEST');
  });

  it('mensagem comum depois do /stop nao reativa', async () => {
    await receber('message', mensagemPrivada('/start'), 22);
    await receber('message', mensagemPrivada('/stop'), 23);
    await receber('message', mensagemPrivada('oi, tudo bem?'), 24);

    // Escrever de novo nao pode desfazer um pedido explicito de saida.
    expect((await vinculo())?.status).toBe('UNSUBSCRIBED');
  });

  it('/start depois do /stop reativa e limpa o opt-out', async () => {
    await receber('message', mensagemPrivada('/start'), 25);
    await receber('message', mensagemPrivada('/stop'), 26);
    await receber('message', mensagemPrivada('/start'), 27);

    // Um novo /start e reconsentimento explicito.
    expect((await vinculo())?.status).toBe('ACTIVE');
    expect(await prisma.optOut.count({ where: { botId } })).toBe(0);
  });
});

describe('mensagem comum', () => {
  it('cria contato para quem ainda nao esta na base', async () => {
    await receber('message', mensagemPrivada('oi'), 30);
    const v = await vinculo();
    expect(v?.status).toBe('ACTIVE');
    expect(v?.consentSource).toBe('PRIVATE_MESSAGE');
  });

  it('ignora mensagens de outros bots', async () => {
    await receber(
      'message',
      {
        message_id: 1,
        from: { id: 999, is_bot: true, first_name: 'Outro' },
        chat: { id: 999, type: 'private' },
        text: 'oi',
      },
      31,
    );
    expect(await prisma.botUser.count({ where: { botId } })).toBe(0);
  });
});

describe('bloqueio do bot', () => {
  it('my_chat_member kicked marca BLOCKED_BOT e cria opt-out', async () => {
    await receber('message', mensagemPrivada('/start'), 40);

    await receber(
      'my_chat_member',
      {
        chat: { id: CHAT_PRIVADO, type: 'private' },
        from: pessoa,
        new_chat_member: { status: 'kicked' },
      },
      41,
    );

    expect((await vinculo())?.status).toBe('BLOCKED_BOT');
    const opt = await prisma.optOut.findFirst({ where: { botId } });
    expect(opt?.reason).toBe('BLOCKED_BOT');
  });

  it('desbloquear volta o contato para ACTIVE', async () => {
    await receber('message', mensagemPrivada('/start'), 42);
    await receber(
      'my_chat_member',
      { chat: { id: CHAT_PRIVADO, type: 'private' }, from: pessoa, new_chat_member: { status: 'kicked' } },
      43,
    );
    await receber(
      'my_chat_member',
      { chat: { id: CHAT_PRIVADO, type: 'private' }, from: pessoa, new_chat_member: { status: 'member' } },
      44,
    );

    expect((await vinculo())?.status).toBe('ACTIVE');
  });
});

describe('grupos e canais', () => {
  it('registra o grupo quando o bot e adicionado', async () => {
    await receber(
      'my_chat_member',
      {
        chat: { id: ID_GRUPO, type: 'supergroup', title: 'Grupo de Clientes' },
        from: pessoa,
        new_chat_member: { status: 'administrator' },
      },
      50,
    );

    const chat = await prisma.chat.findFirst({ where: { botId } });
    expect(chat?.title).toBe('Grupo de Clientes');
    expect(chat?.type).toBe('SUPERGROUP');
    expect(chat?.botStatus).toBe('ADMINISTRATOR');
  });

  it('nao cria contato a partir de mensagem em grupo', async () => {
    // A Bot API nao permite escrever no privado de quem nunca falou com o bot:
    // ver alguem no grupo nao autoriza envio.
    await receber(
      'message',
      {
        message_id: 1,
        from: pessoa,
        chat: { id: ID_GRUPO, type: 'supergroup', title: 'Grupo' },
        text: 'oi pessoal',
      },
      51,
    );

    expect(await prisma.botUser.count({ where: { botId } })).toBe(0);
    expect(await prisma.chat.count({ where: { botId } })).toBe(1);
  });

  it('marca o grupo quando o bot e removido', async () => {
    await receber(
      'my_chat_member',
      { chat: { id: ID_GRUPO, type: 'supergroup', title: 'Grupo' }, from: pessoa, new_chat_member: { status: 'member' } },
      52,
    );
    await receber(
      'my_chat_member',
      { chat: { id: ID_GRUPO, type: 'supergroup', title: 'Grupo' }, from: pessoa, new_chat_member: { status: 'kicked' } },
      53,
    );

    const chat = await prisma.chat.findFirst({ where: { botId } });
    expect(chat?.botStatus).toBe('KICKED');
    expect(await prisma.chat.count({ where: { botId } })).toBe(1);
  });
});

describe('varredura', () => {
  it('processa updates que ficaram pendentes', async () => {
    // Simula um update gravado por um processo que caiu antes de trata-lo:
    // createdAt antigo o bastante para passar da carencia.
    await prisma.telegramUpdate.create({
      data: {
        botId,
        updateId: 60n,
        type: 'message',
        payload: { update_id: 60, message: mensagemPrivada('/start') },
        createdAt: new Date(Date.now() - 60_000),
      },
    });

    const tratados = await updates.varrer();

    expect(tratados).toBe(1);
    expect((await vinculo())?.status).toBe('ACTIVE');
    const registro = await prisma.telegramUpdate.findFirstOrThrow({ where: { updateId: 60n } });
    expect(registro.processedAt).not.toBeNull();
  });

  it('nao pega updates recem-gravados', async () => {
    // Carencia: o processamento imediato provavelmente ja esta cuidando deles.
    await prisma.telegramUpdate.create({
      data: {
        botId,
        updateId: 61n,
        type: 'message',
        payload: { update_id: 61, message: mensagemPrivada('/start') },
      },
    });

    expect(await updates.varrer()).toBe(0);
  });
});

describe('callback de botao', () => {
  it('registra contato a partir de clique em botao inline', async () => {
    await receber(
      'callback_query',
      {
        id: 'cb1',
        from: pessoa,
        data: 'confirmar',
        message: { message_id: 9, chat: { id: CHAT_PRIVADO, type: 'private' } },
      },
      70,
    );

    const v = await vinculo();
    expect(v?.status).toBe('ACTIVE');
    expect(v?.consentSource).toBe('CALLBACK_QUERY');
    expect(v?.privateChatId).toBe(BigInt(CHAT_PRIVADO));
  });
});
