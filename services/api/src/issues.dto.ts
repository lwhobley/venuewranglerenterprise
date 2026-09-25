import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { IssueSeverity } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateIssueDto {
  @ApiProperty({ minLength: 3, maxLength: 140 }) @IsString() @Length(3, 140) title!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @Length(1, 4000) description!: string;
  @ApiProperty({ maxLength: 80 }) @IsString() @Length(2, 80) category!: string;
  @ApiProperty({ enum: IssueSeverity }) @IsEnum(IssueSeverity) severity!: IssueSeverity;
  @ApiProperty({ format: 'uuid' }) @IsUUID() venueId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() locationId?: string;
  @ApiPropertyOptional({ minimum: -90, maximum: 90 }) @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional({ minimum: -180, maximum: 180 }) @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10000 }) @IsOptional() @IsNumber() @Min(0) @Max(10000) locationAccuracyMeters?: number;
  @ApiPropertyOptional({ format: 'date-time' }) @IsOptional() @IsDateString() locationCapturedAt?: string;
}
export class AssignIssueDto { @ApiProperty() @IsString() @Length(1, 160) ownerId!: string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) reason?: string; }
export class IssueNoteDto { @ApiProperty() @IsString() @Length(1, 1000) reason!: string; }
