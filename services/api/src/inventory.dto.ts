import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

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
