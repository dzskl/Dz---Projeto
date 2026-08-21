import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createLogger, getEnv } from '@tg/config';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

const logger = createLogger('api');

async function bootstrap(): Promise<void> {
  // getEnv() valida o ambiente e lanca se algo estiver faltando: o processo nao
  // sobe pela metade.
  const env = getEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // O log da aplicacao usa Pino (JSON); o logger do Nest so atrapalharia o
    // formato estruturado.
    logger: env.NODE_ENV === 'development' ? ['error', 'warn', 'log'] : ['error', 'warn'],
  });

  app.use(helmet());
  app.use(cookieParser());

  /**
   * CORS com credenciais.
   *
   * O cookie de sessao so e enviado pelo navegador se a origem estiver
   * explicitamente liberada e credentials for true — nao existe curinga aqui.
   */
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // Necessario para que req.ip traga o IP real atras do balanceador (Cloud Run,
  // nginx). Sem isso, a auditoria registraria o IP do proxy.
  app.set('trust proxy', 1);

  await app.listen(env.API_PORT, '0.0.0.0');
  logger.info({ port: env.API_PORT, env: env.NODE_ENV }, 'API no ar');
}

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, 'falha ao iniciar a API');
  process.exit(1);
});
