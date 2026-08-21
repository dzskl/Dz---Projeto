import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hash } from '@node-rs/argon2';
import { prisma } from '@tg/database';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { DomainExceptionFilter } from '../common/filters/domain-exception.filter';
import { SESSION_COOKIE } from './session.service';

/**
 * Testes de ponta a ponta da autenticacao.
 *
 * Sobem a aplicacao real (guards e filtro globais incluidos) contra um
 * PostgreSQL real. O que se quer garantir aqui e comportamento observavel pelo
 * cliente, nao a implementacao interna.
 */

const EMAIL = 'teste.auth@exemplo.com';
const SENHA = 'senha-de-teste-longa';

let app: INestApplication;
let adminId: string;

/** Extrai o cookie de sessao do cabecalho Set-Cookie. */
function sessionCookieFrom(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new DomainExceptionFilter());
  app.setGlobalPrefix('api');
  await app.init();

  await prisma.admin.deleteMany({ where: { email: EMAIL } });
  const admin = await prisma.admin.create({
    data: {
      email: EMAIL,
      name: 'Teste',
      role: 'OWNER',
      passwordHash: await hash(SENHA, { memoryCost: 19_456, timeCost: 2, parallelism: 1 }),
    },
  });
  adminId = admin.id;
});

afterAll(async () => {
  await prisma.admin.deleteMany({ where: { email: EMAIL } });
  await app.close();
  await prisma.$disconnect();
});

describe('rotas protegidas por padrao', () => {
  it('recusa /auth/me sem cookie', async () => {
    const res = await request(app.getHttpServer()).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('expoe /health sem autenticacao', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.database.ok).toBe(true);
  });
});

describe('login', () => {
  it('recusa senha errada sem revelar se o e-mail existe', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'senha-errada-qualquer' });

    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('E-mail ou senha incorretos.');
    expect(sessionCookieFrom(res)).toBeUndefined();
  });

  it('devolve a MESMA mensagem para e-mail inexistente', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nao.existe@exemplo.com', password: 'seja-la-o-que-for' });

    expect(res.status).toBe(401);
    // Mensagens identicas: o cliente nao consegue enumerar contas.
    expect(res.body.error.message).toBe('E-mail ou senha incorretos.');
  });

  it('rejeita corpo invalido com detalhe por campo', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nao-e-email', password: '' });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.fields).toHaveProperty('email');
  });

  it('aceita credenciais corretas e entrega cookie httpOnly', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: SENHA });

    expect(res.status).toBe(200);
    expect(res.body.admin.email).toBe(EMAIL);
    // O hash da senha nunca pode sair na resposta.
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');

    const cookie = sessionCookieFrom(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
  });

  it('nao guarda o token da sessao em texto puro no banco', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: SENHA });

    const cookie = sessionCookieFrom(res) ?? '';
    const token = cookie.split(';')[0]?.split('=')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const encontrado = await prisma.session.findFirst({ where: { tokenHash: token } });
    expect(encontrado).toBeNull();
  });
});

describe('sessao', () => {
  it('permite acessar /auth/me com o cookie e invalida apos logout', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent.post('/api/auth/login').send({ email: EMAIL, password: SENHA }).expect(200);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.admin.id).toBe(adminId);

    await agent.post('/api/auth/logout').expect(204);

    // O mesmo agente mantem o cookie; ele agora deve estar revogado.
    const depois = await agent.get('/api/auth/me');
    expect(depois.status).toBe(401);
  });

  it('recusa token forjado', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=token-inventado-qualquer`);
    expect(res.status).toBe(401);
  });
});

describe('auditoria', () => {
  it('registra sucesso e falha de login', async () => {
    await prisma.auditLog.deleteMany({ where: { adminId } });

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: EMAIL, password: 'errada' });
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: EMAIL, password: SENHA });

    const acoes = await prisma.auditLog.findMany({
      where: { adminId },
      select: { action: true },
    });
    const nomes = acoes.map((a) => a.action);
    expect(nomes).toContain('LOGIN_FAILED');
    expect(nomes).toContain('LOGIN');
  });
});
