import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { ProductHistoryController } from './product-history.controller';
import { ProductHistoryService } from './product-history.service';

/**
 * Tracing a product back through its suppliers, and a unit back through its life.
 *
 * InventoryModule is imported for StockService: registering serials must obey
 * the same container rules whichever endpoint is used, so the counting lives in
 * one place rather than being reimplemented here.
 */
@Module({
  imports: [InventoryModule],
  controllers: [ProductHistoryController],
  providers: [ProductHistoryService],
  exports: [ProductHistoryService],
})
export class ProductHistoryModule {}
