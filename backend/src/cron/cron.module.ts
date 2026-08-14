import { Module } from '@nestjs/common';
import { BackupModule } from '../backup/backup.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CronController } from './cron.controller';

@Module({
  imports: [BackupModule, MaintenanceModule, NotificationsModule],
  controllers: [CronController],
})
export class CronModule {}
