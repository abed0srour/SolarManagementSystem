import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [NumberingService, AuditService],
  exports: [NumberingService, AuditService],
})
export class CommonModule {}
