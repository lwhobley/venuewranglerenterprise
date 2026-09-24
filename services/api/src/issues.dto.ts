import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { IssueSeverity } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateIssueDto {
  @ApiProperty({ minLength: 3, maxLength: 140 }) @IsString() @Length(3, 140) title!: string;
  @ApiProperty({ maxLength: 4000 }) @IsString() @Length(1, 4000) description!: string;
  @ApiProperty({ maxLength: 80 }) @IsString() @Length(2, 80) category!: string;
  @ApiProperty({ enum: IssueSeverity }) @IsEnum(IssueSeverity) severity!: IssueSeverity;
  @ApiProperty({ format: 'uuid' }) @IsUUID() venueId!: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() locationId?: string;
}
export class AssignIssueDto { @ApiProperty() @IsString() @Length(1, 160) ownerId!: string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 1000) reason?: string; }
export class IssueNoteDto { @ApiProperty() @IsString() @Length(1, 1000) reason!: string; }
