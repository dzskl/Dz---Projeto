import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Admin } from '@tg/database';
import {
  AdminRole,
  changePasswordSchema,
  createAdminSchema,
  loginSchema,
  type AdminPublic,
  type ChangePasswordInput,
  type CreateAdminInput,
  type LoginInput,
} from '@tg/shared';
import type { Request, Response } from 'express';
import { CurrentAdmin, SessionToken } from '../common/decorators/current-admin.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService, type RequestContext } from './auth.service';
import { SESSION_COOKIE, opcoesDoCookie } from './session.service';

/** Extrai IP e user-agent para a auditoria. */
function contextOf(req: Request): RequestContext {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Login.
   *
   * O token vai num cookie httpOnly — inacessivel a JavaScript, o que remove a
   * classe de ataque em que um XSS rouba o token. Por isso nao ha token no corpo
   * da resposta.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ admin: AdminPublic }> {
    const { admin, token, expiresAt } = await this.auth.login(body, contextOf(req));

    res.cookie(SESSION_COOKIE, token, { ...opcoesDoCookie(), expires: expiresAt });

    return { admin };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentAdmin() admin: Admin,
    @SessionToken() token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(token, admin.id, contextOf(req));
    res.clearCookie(SESSION_COOKIE, opcoesDoCookie());
  }

  /** Dados do usuario logado — usado pelo painel para restaurar a sessao. */
  @Get('me')
  me(@CurrentAdmin() admin: Admin): { admin: AdminPublic } {
    return { admin: AuthService.toPublic(admin) };
  }

  /** Cria administrador. Restrito a OWNER. */
  @Roles(AdminRole.OWNER)
  @Post('admins')
  @HttpCode(HttpStatus.CREATED)
  async createAdmin(
    @Body(new ZodValidationPipe(createAdminSchema)) body: CreateAdminInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
  ): Promise<{ admin: AdminPublic }> {
    const created = await this.auth.createAdmin(body, admin.id, contextOf(req));
    return { admin: created };
  }

  /**
   * Troca da propria senha.
   *
   * Revoga todas as sessoes, inclusive a atual — o cookie e limpo aqui e o
   * painel redireciona para o login.
   */
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentAdmin() admin: Admin,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(admin.id, body, contextOf(req));
    res.clearCookie(SESSION_COOKIE, opcoesDoCookie());
  }
}
