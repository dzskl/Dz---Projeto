import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import type { Admin } from '@tg/database';
import {
  AdminRole,
  atualizarBotSchema,
  criarBotSchema,
  type AtualizarBotInput,
  type BotPublico,
  type CriarBotInput,
} from '@tg/shared';
import type { Request } from 'express';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { RequestContext } from '../auth/auth.service';
import { BotsService } from './bots.service';

function contextOf(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * Gestao de bots.
 *
 * Leitura e liberada a qualquer autenticado; escrita exige OWNER ou ADMIN,
 * porque quem cadastra ou exclui um bot mexe na base inteira de contatos dele.
 */
@Controller('bots')
export class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Get()
  async listar(): Promise<{ bots: BotPublico[] }> {
    return { bots: await this.bots.listar() };
  }

  @Get(':id')
  async buscar(@Param('id') id: string): Promise<{ bot: BotPublico }> {
    return { bot: await this.bots.buscar(id) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body(new ZodValidationPipe(criarBotSchema)) body: CriarBotInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ bot: BotPublico }> {
    return { bot: await this.bots.criar(body, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN)
  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarBotSchema)) body: AtualizarBotInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ bot: BotPublico }> {
    return { bot: await this.bots.atualizar(id, body, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN)
  @Post(':id/reconectar')
  @HttpCode(HttpStatus.OK)
  async reconectar(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ bot: BotPublico }> {
    return { bot: await this.bots.reconectar(id, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async excluir(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<void> {
    await this.bots.excluir(id, admin.id, contextOf(req));
  }
}
