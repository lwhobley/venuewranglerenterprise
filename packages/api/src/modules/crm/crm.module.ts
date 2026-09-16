import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CrmController } from './crm.controller';
import { OperationsModule } from '../operations/operations.module';

@Module({
  imports: [PrismaModule, BillingModule, OperationsModule],
  controllers: [CrmController],
})
export class CrmModule {}
