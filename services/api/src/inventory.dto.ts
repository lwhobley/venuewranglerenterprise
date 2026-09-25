import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStockItemDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiProperty() @IsString() @Length(1, 80) sku!: string;
  @ApiProperty() @IsString() @Length(2, 160) name!: string;
  @ApiProperty() @IsString() @Length(1, 24) unit!: string;
}

export class StartStockCountDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
}

export class RecordStockCountDto {
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100000000) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class ApproveStockCountDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class CreateStockTransferLineDto {
  @ApiProperty() @IsUUID() itemId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000000) quantity!: number;
}

export class CreateStockTransferDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional({ description: 'Omit for venue-wide stock.' }) @IsOptional() @IsUUID() sourceLocationId?: string;
  @ApiPropertyOptional({ description: 'Omit for venue-wide stock.' }) @IsOptional() @IsUUID() destinationLocationId?: string;
  @ApiProperty({ type: [CreateStockTransferLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((line: CreateStockTransferLineDto) => line.itemId) @ValidateNested({ each: true }) @Type(() => CreateStockTransferLineDto) lines!: CreateStockTransferLineDto[];
}

export class ReceiveStockTransferLineDto {
  @ApiProperty() @IsUUID() lineId!: string;
  @ApiProperty({ description: 'Quantity physically received; must not exceed dispatched quantity.' }) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) @Max(100000000) quantity!: number;
}

export class ReceiveStockTransferDto {
  @ApiProperty({ type: [ReceiveStockTransferLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((line: ReceiveStockTransferLineDto) => line.lineId) @ValidateNested({ each: true }) @Type(() => ReceiveStockTransferLineDto) lines!: ReceiveStockTransferLineDto[];
  @ApiPropertyOptional({ description: 'Required when received quantities differ from dispatched quantities.' }) @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class CancelStockTransferDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class CreateStockPurchaseOrderLineDto {
  @ApiProperty() @IsUUID() itemId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000000) quantity!: number;
}

export class CreateStockPurchaseOrderDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional({ description: 'Omit for venue-wide stock.' }) @IsOptional() @IsUUID() locationId?: string;
  @ApiProperty() @IsString() @Length(2, 160) supplierName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) supplierReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) note?: string;
  @ApiProperty({ type: [CreateStockPurchaseOrderLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((line: CreateStockPurchaseOrderLineDto) => line.itemId) @ValidateNested({ each: true }) @Type(() => CreateStockPurchaseOrderLineDto) lines!: CreateStockPurchaseOrderLineDto[];
}

export class ReceiveStockPurchaseOrderLineDto {
  @ApiProperty() @IsUUID() lineId!: string;
  @ApiProperty({ description: 'Incremental quantity physically received; cannot exceed the remaining ordered amount.' }) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000000) quantity!: number;
}

export class ReceiveStockPurchaseOrderDto {
  @ApiProperty({ type: [ReceiveStockPurchaseOrderLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique((line: ReceiveStockPurchaseOrderLineDto) => line.lineId) @ValidateNested({ each: true }) @Type(() => ReceiveStockPurchaseOrderLineDto) lines!: ReceiveStockPurchaseOrderLineDto[];
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class CloseStockPurchaseOrderShortDto {
  @ApiProperty({ minLength: 3, maxLength: 500, description: 'Required explanation for closing the outstanding quantities.' }) @IsString() @Length(3, 500) reason!: string;
}
