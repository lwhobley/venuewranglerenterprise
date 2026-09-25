import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, ValidateNested } from 'class-validator';

export class HospitalityOrderLineDto {
  @ApiPropertyOptional({ description: 'Optional link to a venue menu catalog item.' }) @IsOptional() @IsUUID() menuItemId?: string;
  @ApiProperty() @IsString() @Length(2, 160) itemName!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000) quantity!: number;
  @ApiProperty() @IsString() @Length(1, 24) unit!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class CreateHospitalityOrderDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiProperty() @IsDateString() serviceAt!: string;
  @ApiPropertyOptional({ description: 'Optional banquet event order reference from the venue system.' }) @IsOptional() @IsString() @Length(1, 120) beoReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) assignedTo?: string;
  @ApiProperty({ type: [HospitalityOrderLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => HospitalityOrderLineDto) lines!: HospitalityOrderLineDto[];
}

export class CreateHospitalityMenuItemDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiProperty() @IsString() @Length(2, 160) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 24) unit?: string;
  @ApiProperty({ description: 'Unit price in the tenant configured currency.' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99999999) unitPrice!: number;
}

export class SetHospitalityMenuItemStatusDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}

export class UpdateHospitalityPolicyDto {
  @ApiPropertyOptional({ description: 'Tenant-configured estimated order value threshold in the tenant configured currency.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  hospitalityApprovalThreshold?: number | null;
  @ApiPropertyOptional({ description: 'ISO 4217 currency code used for menu prices and approval threshold.' })
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/)
  hospitalityCurrencyCode?: string;
}

export class HospitalityFulfillmentLineDto {
  @ApiProperty() @IsUUID() lineId!: string;
  @ApiProperty({ description: 'Quantity delivered in this fulfillment batch.' }) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000) quantity!: number;
  @ApiPropertyOptional({ description: 'Replacement item supplied instead of the requested item.' }) @IsOptional() @IsString() @Length(2, 160) substituteItemName?: string;
  @ApiPropertyOptional({ description: 'Required when a replacement item is supplied.' }) @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class HospitalityOrderActionDto {
  @ApiProperty({ enum: ['approve', 'accept', 'preparing', 'ready', 'distribute', 'fulfill', 'pickup', 'reject', 'cancel'] })
  @IsIn(['approve', 'accept', 'preparing', 'ready', 'distribute', 'fulfill', 'pickup', 'reject', 'cancel']) action!: 'approve' | 'accept' | 'preparing' | 'ready' | 'distribute' | 'fulfill' | 'pickup' | 'reject' | 'cancel';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) reason?: string;
  @ApiPropertyOptional({ type: [HospitalityFulfillmentLineDto] }) @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => HospitalityFulfillmentLineDto) fulfillments?: HospitalityFulfillmentLineDto[];
  @ApiPropertyOptional({ description: 'Name of the person receiving the completed hospitality order.' }) @IsOptional() @IsString() @Length(2, 120) receivedByName?: string;
  @ApiPropertyOptional({ description: 'Short non-sensitive note recorded with the handoff.' }) @IsOptional() @IsString() @Length(0, 500) receiptNote?: string;
  @ApiPropertyOptional({ description: 'Must be true to confirm an in-person handoff.' }) @IsOptional() @IsBoolean() receiverAcknowledged?: boolean;
  @ApiPropertyOptional({ description: 'JSON array of normalized signature strokes captured from the receiver. Required for pickup.' }) @IsOptional() @IsString() @Length(2, 20000) receiverSignature?: string;
}
