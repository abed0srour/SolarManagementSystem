import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  @Get()
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Post('run-checks')
  runChecks() {
    return this.service.runChecks().then(() => ({ success: true }));
  }

  @Post('read-all')
  markAllRead() {
    return this.service.markAllRead();
  }

  @Post(':id/read')
  markRead(@Param('id') id: string) {
    return this.service.markRead(id);
  }
}
