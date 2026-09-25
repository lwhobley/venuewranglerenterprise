import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';

export class HospitalityOrderLineDto {
  @ApiProperty() @IsString() @Length(2, 160) itemName!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) @Max(100000) quantity!: number;
  @ApiProperty() @IsString() @Length(1, 24) unit!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class CreateHospitalityOrderDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiProperty() @IsDateString() serviceAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) assignedTo?: string;
  @ApiProperty({ type: [HospitalityOrderLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => HospitalityOrderLineDto) lines!: HospitalityOrderLineDto[];
}

export class HospitalityOrderActionDto {
  @ApiProperty({ enum: ['accept', 'preparing', 'ready', 'distribute', 'pickup', 'reject', 'cancel'] })
  @IsIn(['accept', 'preparing', 'ready', 'distribute', 'pickup', 'reject', 'cancel']) action!: 'accept' | 'preparing' | 'ready' | 'distribute' | 'pickup' | 'reject' | 'cancel';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(3, 500) reason?: string;
}
