import { Module } from '@nestjs/common';
import { ServiceJobsController } from './service-jobs.controller';
import { ServiceJobsService } from './service-jobs.service';

@Module({
  controllers: [ServiceJobsController],
  providers: [ServiceJobsService],
})
export class ServiceJobsModule {}
