import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { RefundsController } from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [InventoryModule, InvoicesModule],
  controllers: [RefundsController],
  providers: [RefundsService],
})
export class RefundsModule {}
