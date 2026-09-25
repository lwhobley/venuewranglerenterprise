import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsDateString, IsIn, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

export class CreateStaffShiftDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) assignedSubject?: string;
  @ApiProperty() @IsString() @Length(2, 120) role!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) instructions?: string;
  @ApiPropertyOptional({ type: [String], description: 'Required current worker qualification codes.' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, { each: true }) requiredQualificationCodes?: string[];
  @ApiProperty() @IsDateString() startsAt!: string;
  @ApiProperty() @IsDateString() endsAt!: string;
}

export class UpdateStaffShiftDto {
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== null && value !== undefined) @IsUUID() locationId?: string | null;
  @ApiPropertyOptional() @ValidateIf((_object, value) => value !== null && value !== undefined) @IsString() @Length(1, 240) assignedSubject?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) role?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) instructions?: string | null;
  @ApiPropertyOptional({ type: [String], description: 'Replace the required worker qualification codes.' }) @IsOptional() @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, { each: true }) requiredQualificationCodes?: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
}

export class RespondToShiftDto {
  @ApiProperty({ enum: ['ACKNOWLEDGED', 'DECLINED'] }) @IsIn(['ACKNOWLEDGED', 'DECLINED']) response!: 'ACKNOWLEDGED' | 'DECLINED';
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 500) reason?: string;
}
