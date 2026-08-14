import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService],
  // Exported so the cron controller can drive the same work over HTTP.
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
