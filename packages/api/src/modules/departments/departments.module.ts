import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { DepartmentsService } from './departments.service';
import { DepartmentInventoryController } from './department-inventory.controller';
import { DepartmentInventoryService } from './department-inventory.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../../billing/billing.module';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [DepartmentsController, DepartmentInventoryController],
  providers: [DepartmentsService, DepartmentInventoryService],
  exports: [DepartmentsService, DepartmentInventoryService],
})
export class DepartmentsModule {}

