import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf } from 'class-validator';

export class CreateStaffShiftDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) assignedSubject?: string;
  @ApiProperty() @IsString() @Length(2, 120) role!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
}

export class UpdateStaffShiftDto {
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== null && value !== undefined) @IsUUID() locationId?: string | null;
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== null && value !== undefined) @IsString() @Length(1, 240) assignedSubject?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) instructions?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
}

export class RespondToShiftDto {
  @ApiProperty({ enum: ['ACKNOWLEDGED', 'DECLINED'] }) @IsIn(['ACKNOWLEDGED', 'DECLINED']) response!: 'ACKNOWLEDGED' | 'DECLINED';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) reason?: string;
}
