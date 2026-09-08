import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { StockService } from './stock.service';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [InventoryController],
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
