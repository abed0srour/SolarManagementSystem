import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  controllers: [BackupController],
  providers: [BackupService],
  // Exported so the cron controller can drive the same work over HTTP.
  exports: [BackupService],
})
export class BackupModule {}
