import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { AuditService } from './audit.service';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [NumberingService, AuditService, MailService],
  exports: [NumberingService, AuditService, MailService],
})
export class CommonModule {}
