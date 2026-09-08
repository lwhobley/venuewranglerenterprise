import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import {
  DepartmentInventoryService,
  type CreateDepartmentItemDto,
  type UpdateDepartmentItemDto,
  type InventoryMovementDto,
  type TransferRequestDto,
} from './department-inventory.service';

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

export class CreateItemDto {
  @IsString()
  sku!: string;

  @IsString()
  name!: string;

  @IsString()
  unit!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  onHand?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  par?: number;

  @IsOptional()
  @IsNumber()
  costCents?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  category?: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  par?: number;

  @IsOptional()
  @IsNumber()
  costCents?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class RecordMovementDto {
  @IsIn(['receive', 'issue', 'waste', '86', 'count', 'transfer_out', 'transfer_in'])
  movementType!: 'receive' | 'issue' | 'waste' | '86' | 'count' | 'transfer_out' | 'transfer_in';

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;
}

export class TransferItemDto {
  @IsString()
  sku!: string;

  @IsString()
  name!: string;

  @IsNumber()
  @Min(1)
  quantity!: number;
}

export class CreateTransferDto {
  @IsString()
  toDepartmentId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransferItemDto)
  items!: TransferItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/departments/:departmentId/inventory')
@RequireSubscription()
export class DepartmentInventoryController {
  constructor(private readonly inventoryService: DepartmentInventoryService) {}

  @Get()
  async listItems(
    @VenueScope() scope: Scope,
    @Param('departmentId') departmentId: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('needsReview') needsReview?: string,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.listItems(scope.venueId, departmentId, scope, {
      search,
      status,
      needsReview: needsReview === 'true' ? true : needsReview === 'false' ? false : undefined,
    });
  }

  @Post()
  async createItem(
    @VenueScope() scope: Scope,
    @Param('departmentId') departmentId: string,
    @Body() body: CreateItemDto,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.createItem(scope.venueId, departmentId, body, scope);
  }

  @Get(':itemId')
  async getItem(
    @VenueScope() scope: Scope,
    @Param('departmentId') departmentId: string,
    @Param('itemId') itemId: string,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.getItem(scope.venueId, departmentId, itemId, scope);
  }

  @Patch(':itemId')
  async updateItem(
    @VenueScope() scope: Scope,
    @Param('departmentId') departmentId: string,
    @Param('itemId') itemId: string,
    @Body() body: UpdateItemDto,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.updateItem(scope.venueId, departmentId, itemId, body, scope);
  }

  @Post(':itemId/movements')
  async recordMovement(
    @VenueScope() scope: Scope,
    @Param('departmentId') departmentId: string,
    @Param('itemId') itemId: string,
    @Body() body: RecordMovementDto,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.recordMovement(scope.venueId, departmentId, itemId, body, scope);
  }

  @Post('transfers')
  async requestTransfer(
    @VenueScope() scope: Scope,
    @Param('departmentId') departmentId: string,
    @Body() body: CreateTransferDto,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.requestTransfer(scope.venueId, departmentId, body, scope);
  }

  @Post('transfers/:transferId/approve')
  async approveTransfer(
    @VenueScope() scope: Scope,
    @Param('transferId') transferId: string,
  ) {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return this.inventoryService.approveTransfer(scope.venueId, transferId, scope);
  }
}
