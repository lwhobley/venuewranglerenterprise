import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';
import { InventoryController } from './inventory.controller';
import { InventoryLedgerService } from './inventory-ledger.service';
import { InventoryService } from './inventory.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryLedgerService],
  exports: [InventoryLedgerService],
})
export class InventoryModule {}
