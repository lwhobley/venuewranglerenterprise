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
