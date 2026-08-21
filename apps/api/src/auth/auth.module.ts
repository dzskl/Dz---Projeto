import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  // SessionService e exportado porque o AuthGuard global depende dele.
  exports: [SessionService],
})
export class AuthModule {}
