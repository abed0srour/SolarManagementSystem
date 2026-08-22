import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { AuditService } from './audit.service';
import { MailService } from './mail.service';
import { StorageService } from './storage';
import { TenantSweepService } from './tenant-sweep.service';

@Global()
@Module({
  providers: [NumberingService, AuditService, MailService, StorageService, TenantSweepService],
  exports: [NumberingService, AuditService, MailService, StorageService, TenantSweepService],
})
export class CommonModule {}
