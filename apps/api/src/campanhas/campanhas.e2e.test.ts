import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { encryptSecret } from '@tg/config';
import { hash } from '@node-rs/argon2';
import { prisma } from '@tg/database';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { DomainExceptionFilter } from '../common/filters/domain-exception.filter';
import { EnvioService } from '../fila/envio.service';
import { encerrarFilas, filaDoBot } from '../fila/fila';
import {
  ErroTelegram,
  TELEGRAM_API_FACTORY,
  type BotaoInline,
  type DadosDoBot,
  type InfoWebhook,
  type TelegramApi,
  type TelegramApiFactory,
} from '../telegram/telegram.types';

/**
 * Testes de campanha.
 *
 * O que se quer garantir e o comportamento do disparo: quem entra na lista, quem
 * fica de fora, e o que acontece quando o envio falha de cada jeito. O Telegram
 * e substituido por uma implementacao controlada, o que permite provocar 403 e
 * erro transitorio sob demanda.
 */

const EMAIL = 'teste.camp@exemplo.com';
const SENHA = 'senha-de-teste-longa';
const TOKEN = '7891234567:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw';
const ID_BOT = 7_891_234_567;

interface Enviada {
  chatId: string;
  texto: string;
  botoes?: BotaoInline[];
}

let enviadas: Enviada[] = [];
/** chatIds que devem falhar com 403 (bloqueou o bot). */
let bloqueados = new Set<string>();
/** chatIds que devem falhar com erro transitorio. */
let instaveis = new Set<string>();

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
  async sendMessage(chatId: number | bigint, texto: string, botoes?: BotaoInline[]): Promise<number> {
    const id = chatId.toString();
    if (bloqueados.has(id)) {
      throw new ErroTelegram('bot was blocked by the user', 403, false, true);
    }
    if (instaveis.has(id)) {
      throw new ErroTelegram('Bad Gateway', 502, false, false);
    }
    enviadas.push({ chatId: id, texto, botoes });
    return enviadas.length;
  }
  async setWebhook(): Promise<void> {}
  async deleteWebhook(): Promise<void> {}
  async getWebhookInfo(): Promise<InfoWebhook> {
    return { url: '', pendingUpdateCount: 0 };
  }
}

const fabricaFalsa: TelegramApiFactory = { create: () => new TelegramFalso() };

let app: INestApplication;
let agente: ReturnType<typeof request.agent>;
let envio: EnvioService;
let botId: string;

/** Cria N contatos elegiveis e devolve seus chatIds. */
async function criarContatos(quantidade: number, inicio = 90_000): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < quantidade; i++) {
    const tgId = BigInt(inicio + i);
    const pessoa = await prisma.telegramUser.create({
      data: { telegramUserId: tgId, firstName: `Pessoa${i}` },
    });
    await prisma.botUser.create({
      data: {
        botId,
        telegramUserId: pessoa.id,
        privateChatId: tgId,
        status: 'ACTIVE',
        consentSource: 'START_COMMAND',
        consentAt: new Date(),
        lastInteractionAt: new Date(),
      },
    });
    ids.push(tgId.toString());
  }
  return ids;
}

/** Processa todos os destinatarios pendentes sem depender do agendamento real. */
async function processarTudo(campanhaId: string): Promise<void> {
  const pendentes = await prisma.campaignRecipient.findMany({
    where: { campaignId: campanhaId, status: { in: ['PENDING', 'QUEUED'] } },
    select: { id: true },
  });
  for (const r of pendentes) {
    await envio
      .processarDireto({
        data: { campanhaId, destinatarioId: r.id, botId },
        attemptsMade: 0,
      } as never)
      .catch(() => {
        // Erro transitorio: o BullMQ retentaria. Aqui basta nao derrubar o teste.
      });
  }
}

async function criarCampanha(extra: Record<string, unknown> = {}): Promise<string> {
  const res = await agente
    .post('/api/campanhas')
    .send({
      nome: 'Campanha de Teste',
      botId,
      mensagens: [{ kind: 'TEXT', texto: 'Ola! Novidades para voce.' }],
      ratePerSecond: 20,
      ...extra,
    })
    .expect(201);
  return res.body.campanha.id;
}

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
  bloqueados = new Set();
  instaveis = new Set();
  await limpar();

  const bot = await prisma.bot.create({
    data: {
      telegramBotId: BigInt(ID_BOT),
      username: 'bot_de_teste',
      name: 'Bot',
      tokenEncrypted: encryptSecret(TOKEN),
      tokenHint: 'Dsaw',
      webhookSecret: 'segredo',
      status: 'CONNECTED',
      isActive: true,
    },
  });
  botId = bot.id;
  // Esvazia a fila entre testes para nao herdar jobs.
  await filaDoBot(botId).obliterate({ force: true }).catch(() => undefined);
});

afterAll(async () => {
  await limpar();
  await prisma.admin.deleteMany({ where: { email: EMAIL } });
  await app.close();
  await encerrarFilas();
  await prisma.$disconnect();
});

describe('criacao', () => {
  it('recusa campanha sem mensagem', async () => {
    const res = await agente
      .post('/api/campanhas')
      .send({ nome: 'Vazia', botId, mensagens: [] });
    expect(res.status).toBe(422);
  });

  it('recusa mensagem de texto sem conteudo', async () => {
    const res = await agente
      .post('/api/campanhas')
      .send({ nome: 'Sem texto', botId, mensagens: [{ kind: 'TEXT', texto: '   ' }] });
    expect(res.status).toBe(422);
  });

  it('recusa velocidade acima do limite do Telegram', async () => {
    // O Telegram corta perto de 30/s; aceitar mais seria prometer o impossivel.
    const res = await agente.post('/api/campanhas').send({
      nome: 'Rapida demais',
      botId,
      mensagens: [{ kind: 'TEXT', texto: 'oi' }],
      ratePerSecond: 100,
    });
    expect(res.status).toBe(422);
  });

  it('cria em rascunho', async () => {
    const id = await criarCampanha();
    const res = await agente.get(`/api/campanhas/${id}`).expect(200);
    expect(res.body.campanha.status).toBe('DRAFT');
  });
});

describe('previa do publico', () => {
  it('conta apenas quem pode receber', async () => {
    await criarContatos(5);
    // Um bloqueou o bot e outro pediu para sair: nenhum dos dois conta.
    const todos = await prisma.botUser.findMany({ orderBy: { privateChatId: 'asc' } });
    await prisma.botUser.update({
      where: { id: todos[0]!.id },
      data: { status: 'BLOCKED_BOT' },
    });
    await prisma.optOut.create({
      data: { botId, telegramUserId: todos[1]!.telegramUserId, reason: 'USER_REQUEST' },
    });

    const id = await criarCampanha();
    const res = await agente.get(`/api/campanhas/${id}/previa`).expect(200);

    expect(res.body.totalNoBot).toBe(5);
    expect(res.body.elegiveis).toBe(3);
    // 3 pessoas a 20/s arredonda para 1 segundo.
    expect(res.body.duracaoEstimadaSegundos).toBe(1);
  });

  it('exclui quem nao tem conversa privada', async () => {
    await criarContatos(3);
    const primeiro = await prisma.botUser.findFirstOrThrow();
    // Sem chat privado o envio e impossivel, por mais ativo que esteja.
    await prisma.botUser.update({ where: { id: primeiro.id }, data: { privateChatId: null } });

    const id = await criarCampanha();
    const res = await agente.get(`/api/campanhas/${id}/previa`).expect(200);
    expect(res.body.elegiveis).toBe(2);
  });
});

describe('inicio e materializacao', () => {
  it('congela a lista de destinatarios', async () => {
    await criarContatos(4);
    const id = await criarCampanha();

    const res = await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);
    expect(res.body.campanha.status).toBe('RUNNING');
    expect(res.body.campanha.totalDestinatarios).toBe(4);

    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(4);
  });

  it('nao inclui quem entrou depois do inicio', async () => {
    // A lista congelada e o que garante contagem estavel do comeco ao fim.
    await criarContatos(2);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    await criarContatos(3, 95_000);

    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(2);
  });

  it('recusa iniciar sem ninguem elegivel', async () => {
    const id = await criarCampanha();
    const res = await agente.post(`/api/campanhas/${id}/iniciar`);
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/elegivel/i);
  });

  it('recusa iniciar com bot desconectado', async () => {
    await criarContatos(2);
    await prisma.bot.update({ where: { id: botId }, data: { status: 'INVALID_TOKEN' } });
    const id = await criarCampanha();
    const res = await agente.post(`/api/campanhas/${id}/iniciar`);
    expect(res.status).toBe(409);
  });

  it('materializar duas vezes nao duplica destinatario', async () => {
    // O unico (campaign_id, bot_user_id) e o que garante isso no banco.
    await criarContatos(3);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    await prisma.campaignRecipient.updateMany({
      where: { campaignId: id },
      data: { status: 'PENDING' },
    });
    await agente.post(`/api/campanhas/${id}/pausar`).expect(200);
    await agente.post(`/api/campanhas/${id}/retomar`).expect(200);

    expect(await prisma.campaignRecipient.count({ where: { campaignId: id } })).toBe(3);
  });
});

describe('envio', () => {
  it('entrega a todos e conclui a campanha', async () => {
    const chats = await criarContatos(3);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    await processarTudo(id);

    expect(enviadas).toHaveLength(3);
    expect(new Set(enviadas.map((e) => e.chatId))).toEqual(new Set(chats));

    const campanha = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    expect(campanha.sentCount).toBe(3);
    expect(campanha.status).toBe('COMPLETED');
    expect(campanha.finishedAt).not.toBeNull();
  });

  it('envia os botoes inline junto com o texto', async () => {
    await criarContatos(1);
    const id = await criarCampanha({
      mensagens: [
        {
          kind: 'TEXT',
          texto: 'Confira a oferta',
          botoes: [{ texto: 'Ver oferta', url: 'https://exemplo.com' }],
        },
      ],
    });
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);
    await processarTudo(id);

    expect(enviadas[0]?.botoes?.[0]?.texto).toBe('Ver oferta');
  });

  it('marca bloqueado e nao retenta quem bloqueou o bot', async () => {
    const chats = await criarContatos(3);
    bloqueados.add(chats[1]!);

    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);
    await processarTudo(id);

    const campanha = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    expect(campanha.sentCount).toBe(2);
    expect(campanha.blockedCount).toBe(1);

    // A descoberta vale para a base inteira, nao so para esta campanha.
    const pessoa = await prisma.telegramUser.findFirstOrThrow({
      where: { telegramUserId: BigInt(chats[1]!) },
    });
    const vinculo = await prisma.botUser.findFirstOrThrow({
      where: { telegramUserId: pessoa.id },
    });
    expect(vinculo.status).toBe('BLOCKED_BOT');
    expect(await prisma.optOut.count({ where: { telegramUserId: pessoa.id } })).toBe(1);
  });

  it('pula quem entrou em opt-out depois da materializacao', async () => {
    // Alguem pode mandar /stop no meio do disparo; a lista congelada nao pode
    // furar um pedido de saida.
    const chats = await criarContatos(3);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    const pessoa = await prisma.telegramUser.findFirstOrThrow({
      where: { telegramUserId: BigInt(chats[2]!) },
    });
    await prisma.optOut.create({
      data: { botId, telegramUserId: pessoa.id, reason: 'USER_REQUEST' },
    });

    await processarTudo(id);

    expect(enviadas.map((e) => e.chatId)).not.toContain(chats[2]);
    const campanha = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    expect(campanha.sentCount).toBe(2);
    expect(campanha.skippedCount).toBe(1);
  });

  it('nao envia duas vezes para o mesmo destinatario', async () => {
    await criarContatos(2);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    await processarTudo(id);
    // Reprocessar tudo: quem ja esta SENT precisa ser ignorado.
    const todos = await prisma.campaignRecipient.findMany({ where: { campaignId: id } });
    for (const r of todos) {
      await envio.processarDireto({
        data: { campanhaId: id, destinatarioId: r.id, botId },
        attemptsMade: 0,
      } as never);
    }

    expect(enviadas).toHaveLength(2);
  });

  it('registra cada tentativa em send_logs', async () => {
    const chats = await criarContatos(2);
    bloqueados.add(chats[0]!);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);
    await processarTudo(id);

    const logs = await prisma.sendLog.findMany({ where: { campaignId: id } });
    expect(logs).toHaveLength(2);
    expect(logs.filter((l) => l.success)).toHaveLength(1);
    expect(logs.find((l) => !l.success)?.httpStatus).toBe(403);
  });
});

describe('erro transitorio', () => {
  it('relanca para o BullMQ retentar', async () => {
    const chats = await criarContatos(1);
    instaveis.add(chats[0]!);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    const destinatario = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId: id },
    });

    // Primeira tentativa: precisa lancar, para o BullMQ agendar a proxima.
    await expect(
      envio.processarDireto({
        data: { campanhaId: id, destinatarioId: destinatario.id, botId },
        attemptsMade: 0,
      } as never),
    ).rejects.toThrow();

    const apos = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: destinatario.id },
    });
    expect(apos.status).toBe('QUEUED');
    expect(apos.attempts).toBe(1);
  });

  it('desiste na ultima tentativa e marca FAILED', async () => {
    const chats = await criarContatos(1);
    instaveis.add(chats[0]!);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    const destinatario = await prisma.campaignRecipient.findFirstOrThrow({
      where: { campaignId: id },
    });

    // attemptsMade = 4 significa que esta e a quinta e ultima tentativa.
    await envio.processarDireto({
      data: { campanhaId: id, destinatarioId: destinatario.id, botId },
      attemptsMade: 4,
    } as never);

    const apos = await prisma.campaignRecipient.findUniqueOrThrow({
      where: { id: destinatario.id },
    });
    expect(apos.status).toBe('FAILED');

    const campanha = await prisma.campaign.findUniqueOrThrow({ where: { id } });
    expect(campanha.failedCount).toBe(1);
  });
});

describe('maquina de estados', () => {
  it('recusa iniciar campanha ja cancelada', async () => {
    await criarContatos(2);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/cancelar`).expect(200);

    const res = await agente.post(`/api/campanhas/${id}/iniciar`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('pausar interrompe o envio', async () => {
    await criarContatos(3);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);
    await agente.post(`/api/campanhas/${id}/pausar`).expect(200);

    // Com a campanha pausada, o worker precisa descartar os jobs.
    await processarTudo(id);
    expect(enviadas).toHaveLength(0);
  });

  it('retomar volta a enviar', async () => {
    await criarContatos(2);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);
    await agente.post(`/api/campanhas/${id}/pausar`).expect(200);
    await agente.post(`/api/campanhas/${id}/retomar`).expect(200);

    await processarTudo(id);
    expect(enviadas).toHaveLength(2);
  });

  it('cancelar marca os nao enviados como ignorados', async () => {
    await criarContatos(4);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    const res = await agente.post(`/api/campanhas/${id}/cancelar`).expect(200);

    // O total precisa continuar fechando: enviados + falhas + bloqueados + ignorados.
    expect(res.body.campanha.status).toBe('CANCELLED');
    expect(res.body.campanha.ignorados).toBe(4);
  });

  it('recusa editar campanha em execucao', async () => {
    await criarContatos(2);
    const id = await criarCampanha();
    await agente.post(`/api/campanhas/${id}/iniciar`).expect(200);

    const res = await agente.patch(`/api/campanhas/${id}`).send({ nome: 'Outro nome' });
    expect(res.status).toBe(409);
  });
});
