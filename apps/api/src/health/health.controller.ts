import { Controller, Get } from '@nestjs/common';
import { checkDatabase } from '@tg/database';
import { Public } from '../common/decorators/public.decorator';

/**
 * Health check.
 *
 * Publico e sem detalhes sensiveis: e consumido pelo balanceador e pelo Cloud
 * Run para decidir se a instancia recebe trafego.
 */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  async check(): Promise<{ status: string; database: { ok: boolean; latencyMs: number } }> {
    const database = await checkDatabase();
    return {
      status: database.ok ? 'ok' : 'degraded',
      database: { ok: database.ok, latencyMs: database.latencyMs },
    };
  }
}
