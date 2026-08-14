import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  // Exported so the cron controller can drive the same work over HTTP.
  exports: [NotificationsService],
})
export class NotificationsModule {}
