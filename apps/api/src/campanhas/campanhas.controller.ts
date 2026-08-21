import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Admin } from '@tg/database';
import {
  AdminRole,
  atualizarCampanhaSchema,
  criarCampanhaSchema,
  type AtualizarCampanhaInput,
  type CampanhaPublica,
  type CriarCampanhaInput,
  type PreviaDoPublico,
} from '@tg/shared';
import type { Request } from 'express';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { RequestContext } from '../auth/auth.service';
import { CampanhasService } from './campanhas.service';

function contextOf(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * Campanhas.
 *
 * Criar e editar exige OPERATOR ou acima; disparar, pausar e cancelar tambem —
 * VIEWER so acompanha.
 */
@Controller('campanhas')
export class CampanhasController {
  constructor(private readonly campanhas: CampanhasService) {}

  @Get()
  async listar(@Query('botId') botId?: string): Promise<{ campanhas: CampanhaPublica[] }> {
    return { campanhas: await this.campanhas.listar(botId) };
  }

  @Get(':id')
  async buscar(@Param('id') id: string): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.buscar(id) };
  }

  /** Quantas pessoas receberiam se a campanha comecasse agora. */
  @Get(':id/previa')
  async previa(@Param('id') id: string): Promise<PreviaDoPublico> {
    return this.campanhas.preverPublico(id);
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async criar(
    @Body(new ZodValidationPipe(criarCampanhaSchema)) body: CriarCampanhaInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.criar(body, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(atualizarCampanhaSchema)) body: AtualizarCampanhaInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.atualizar(id, body, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post(':id/iniciar')
  @HttpCode(HttpStatus.OK)
  async iniciar(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.iniciar(id, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post(':id/pausar')
  @HttpCode(HttpStatus.OK)
  async pausar(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.pausar(id, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post(':id/retomar')
  @HttpCode(HttpStatus.OK)
  async retomar(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.retomar(id, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN, AdminRole.OPERATOR)
  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  async cancelar(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ campanha: CampanhaPublica }> {
    return { campanha: await this.campanhas.cancelar(id, admin.id, contextOf(req)) };
  }
}
