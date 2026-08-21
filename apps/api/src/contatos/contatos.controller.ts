import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import type { Admin } from '@tg/database';
import {
  AdminRole,
  criarOptOutSchema,
  listarContatosSchema,
  validate,
  type CriarOptOutInput,
  type OptOutPublico,
  type PaginaDeContatos,
} from '@tg/shared';
import type { Request } from 'express';
import { CurrentAdmin } from '../common/decorators/current-admin.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { RequestContext } from '../auth/auth.service';
import { ContatosService } from './contatos.service';

function contextOf(req: Request): RequestContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@Controller('contatos')
export class ContatosController {
  constructor(private readonly contatos: ContatosService) {}

  @Get()
  async listar(@Query() query: Record<string, string>): Promise<PaginaDeContatos> {
    // A query string chega como texto; o schema converte e aplica os limites.
    return this.contatos.listar(validate(listarContatosSchema, query));
  }

  @Get('opt-outs')
  async listarOptOuts(): Promise<{ optOuts: OptOutPublico[] }> {
    return { optOuts: await this.contatos.listarOptOuts() };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN)
  @Post('opt-outs')
  @HttpCode(HttpStatus.CREATED)
  async criarOptOut(
    @Body(new ZodValidationPipe(criarOptOutSchema)) body: CriarOptOutInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ optOut: OptOutPublico }> {
    return { optOut: await this.contatos.criarOptOut(body, admin.id, contextOf(req)) };
  }

  @Roles(AdminRole.OWNER, AdminRole.ADMIN)
  @Delete('opt-outs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removerOptOut(
    @Param('id') id: string,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<void> {
    await this.contatos.removerOptOut(id, admin.id, contextOf(req));
  }
}
