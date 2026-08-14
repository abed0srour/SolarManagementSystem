import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { AuditService } from './audit.service';
import { MailService } from './mail.service';
import { StorageService } from './storage';

@Global()
@Module({
  providers: [NumberingService, AuditService, MailService, StorageService],
  exports: [NumberingService, AuditService, MailService, StorageService],
})
export class CommonModule {}
