import { Module } from '@nestjs/common';
import { CampanhasController } from './campanhas.controller';
import { CampanhasService } from './campanhas.service';

@Module({
  controllers: [CampanhasController],
  providers: [CampanhasService],
})
export class CampanhasModule {}
