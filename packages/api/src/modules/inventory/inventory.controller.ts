import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RequireSubscription } from '../../billing/require-subscription.decorator';
import { VenueScope } from '../../venue/venue-scope.decorator';
import type { VenueScopedRequest } from '../../venue/venue-scope.interceptor';
import { TenantRequestTransactionInterceptor } from '../../prisma/tenant-request-transaction.interceptor';
import { DIRECT_MOVEMENT_TYPES, InventoryService, type DirectMovementType, type InventoryScope } from './inventory.service';
import type { StockStatus } from './inventory-movement';

const DOMAINS = ['food', 'beverage', 'equipment', 'packaging', 'supply'] as const;
type Domain = (typeof DOMAINS)[number];
const LOCATION_KINDS = [
  'department', 'kitchen', 'bar', 'concession_stand', 'suite', 'club', 'catering', 'warehouse',
  'storage', 'cooler', 'freezer', 'mobile_cart', 'event_storage', 'bin', 'other',
] as const;
const STATUSES = ['out', 'critical', 'low', 'ok', 'untracked'] as const;

type Scope = NonNullable<VenueScopedRequest['venueScope']>;

export class CreateCategoryDto {
  @IsIn(DOMAINS) domain!: Domain;
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() parentId?: string;
}

export class CreateLocationDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsIn(LOCATION_KINDS) kind?: (typeof LOCATION_KINDS)[number];
  @IsOptional() @IsString() parentId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdateItemDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(80) internalSku?: string;
  @IsOptional() @IsString() @MaxLength(80) barcode?: string;
  @IsOptional() @IsString() @MaxLength(80) vendorSku?: string;
  @IsOptional() @IsString() @MaxLength(120) brand?: string;
  @IsOptional() @IsString() @MaxLength(24) baseUnit?: string;
  @IsOptional() @IsString() @MaxLength(24) purchaseUnit?: string;
  @IsOptional() @IsNumber() @Min(0.0001) purchaseToBase?: number;
  @IsOptional() @IsString() @MaxLength(60) packSize?: string;
  @IsOptional() @IsString() @MaxLength(40) storageCondition?: string;
  @IsOptional() @IsNumber() @Min(0) unitCostCents?: number;
  @IsOptional() @IsString() @MaxLength(120) supplier?: string;
  @IsOptional() @IsBoolean() trackExpiration?: boolean;
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

export class CreateItemDto extends UpdateItemDto {
  @IsIn(DOMAINS) domain!: Domain;
  @IsString() @MaxLength(160) declare name: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsNumber() @Min(0) openingQuantity?: number;
  @IsOptional() @IsNumber() @Min(0) par?: number;
}

export class SetActiveDto {
  @IsBoolean() active!: boolean;
}

export class LocationSettingsDto {
  @IsOptional() @IsNumber() @Min(0) par?: number | null;
  @IsOptional() @IsNumber() @Min(0) reorderPoint?: number | null;
  @IsOptional() @IsNumber() @Min(0) reorderQty?: number | null;
}

export class MovementDto {
  @IsString() itemId!: string;
  @IsString() locationId!: string;
  @IsIn(DIRECT_MOVEMENT_TYPES) type!: DirectMovementType;
  @IsNumber() quantity!: number;
  @IsOptional() @IsString() @MaxLength(60) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsNumber() @Min(0) unitCostCents?: number;
}

export class TransferLineDto {
  @IsString() itemId!: string;
  @IsNumber() @Min(0.0001) quantity!: number;
}

export class TransferDto {
  @IsString() fromLocationId!: string;
  @IsString() toLocationId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200)
  @ValidateNested({ each: true }) @Type(() => TransferLineDto)
  lines!: TransferLineDto[];
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@UseInterceptors(TenantRequestTransactionInterceptor)
@Controller('v1/inventory')
@RequireSubscription()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  private scope(scope: Scope | undefined): InventoryScope {
    if (!scope) throw new ForbiddenException('Not authenticated');
    return scope;
  }

  @Get('dashboard')
  dashboard(@VenueScope() scope: Scope) {
    return this.inventory.dashboard(this.scope(scope));
  }

  @Get('categories')
  categories(@VenueScope() scope: Scope, @Query('domain') domain?: string) {
    return this.inventory.listCategories(this.scope(scope), (DOMAINS as readonly string[]).includes(domain ?? '') ? (domain as Domain) : undefined);
  }

  @Post('categories')
  createCategory(@VenueScope() scope: Scope, @Body() body: CreateCategoryDto) {
    return this.inventory.createCategory(this.scope(scope), body);
  }

  @Get('locations')
  locations(@VenueScope() scope: Scope) {
    return this.inventory.listLocations(this.scope(scope));
  }

  @Post('locations')
  createLocation(@VenueScope() scope: Scope, @Body() body: CreateLocationDto) {
    return this.inventory.createLocation(this.scope(scope), body);
  }

  @Get('items')
  listItems(
    @VenueScope() scope: Scope,
    @Query('domain') domain?: string,
    @Query('categoryId') categoryId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('includeArchived') includeArchived?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventory.listItems(this.scope(scope), {
      domain: (DOMAINS as readonly string[]).includes(domain ?? '') ? (domain as Domain) : undefined,
      categoryId: categoryId || undefined,
      locationId: locationId || undefined,
      status: (STATUSES as readonly string[]).includes(status ?? '') ? (status as StockStatus) : undefined,
      search: search?.slice(0, 120),
      includeArchived: includeArchived === 'true',
      offset: Number.parseInt(offset ?? '0', 10) || 0,
      limit: Number.parseInt(limit ?? '50', 10) || 50,
    });
  }

  @Post('items')
  createItem(@VenueScope() scope: Scope, @Body() body: CreateItemDto) {
    return this.inventory.createItem(this.scope(scope), body);
  }

  @Get('items/:id')
  getItem(@VenueScope() scope: Scope, @Param('id') id: string) {
    return this.inventory.getItem(this.scope(scope), id);
  }

  @Patch('items/:id')
  updateItem(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: UpdateItemDto) {
    return this.inventory.updateItem(this.scope(scope), id, body);
  }

  @Post('items/:id/active')
  setActive(@VenueScope() scope: Scope, @Param('id') id: string, @Body() body: SetActiveDto) {
    return this.inventory.setItemActive(this.scope(scope), id, body.active);
  }

  @Post('items/:id/locations/:locationId')
  setLocationSettings(
    @VenueScope() scope: Scope,
    @Param('id') id: string,
    @Param('locationId') locationId: string,
    @Body() body: LocationSettingsDto,
  ) {
    return this.inventory.setLocationSettings(this.scope(scope), id, locationId, body);
  }

  /** Idempotency-Key makes a retried or double-tapped movement land once. */
  @Post('transactions')
  recordMovement(
    @VenueScope() scope: Scope,
    @Body() body: MovementDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventory.recordMovement(this.scope(scope), { ...body, idempotencyKey: idempotencyKey?.slice(0, 120) });
  }

  @Post('transfers')
  transfer(
    @VenueScope() scope: Scope,
    @Body() body: TransferDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.inventory.transfer(this.scope(scope), { ...body, idempotencyKey: idempotencyKey?.slice(0, 120) });
  }

  @Post('migrate-legacy')
  migrateLegacy(@VenueScope() scope: Scope) {
    return this.inventory.migrateLegacy(this.scope(scope));
  }
}
