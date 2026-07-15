import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { StockService } from './stock.service';

@Module({
  controllers: [InventoryController],
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
