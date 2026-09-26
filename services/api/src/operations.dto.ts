import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { OperationalTaskKind, OperationalTaskState } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVenueDto { @ApiProperty() @IsString() @Length(2, 120) name!: string; @ApiProperty({ example: 'America/Chicago' }) @IsString() @Length(1, 64) timeZone!: string; }
export class UpdateOrganizationDto { @ApiProperty() @IsString() @Length(2, 160) name!: string; }
export class CreateLocationDto { @ApiProperty() @IsUUID() venueId!: string; @ApiProperty() @IsString() @Length(2, 120) name!: string; }
export class CreateEventDto { @ApiProperty() @IsUUID() venueId!: string; @ApiProperty() @IsString() @Length(2, 160) name!: string; @ApiProperty() @IsDateString() startsAt!: string; }
export class UpdateVenueDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string; @ApiPropertyOptional({ example: 'America/Chicago' }) @IsOptional() @IsString() @Length(1, 64) timeZone?: string; }
export class UpdateVenueLifecycleDto { @ApiProperty({ enum: ['activate', 'suspend'] }) @IsIn(['activate', 'suspend']) action!: 'activate' | 'suspend'; }
export class UpdateLocationDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string; }
export class UpdateEventDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) name?: string; @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string; }
export class UpsertPersonDto { @ApiProperty() @IsString() @Length(1, 240) externalSubject!: string; @ApiProperty() @IsEmail() email!: string; @ApiProperty() @IsString() @Length(1, 160) displayName!: string; }
export class SetPersonActiveDto { @ApiProperty() @IsBoolean() active!: boolean; }
export class CreateOperationalTaskDto {
  @ApiProperty({ enum: OperationalTaskKind }) @IsEnum(OperationalTaskKind) kind!: OperationalTaskKind;
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() locationId?: string;
  @ApiProperty() @IsString() @Length(2, 160) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(999999999) expectedQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 32) unit?: string;
}
export class UpdateOperationalTaskDto {
  @ApiPropertyOptional({ enum: OperationalTaskState }) @IsOptional() @IsEnum(OperationalTaskState) state?: OperationalTaskState;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 240) ownerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(999999999) actualQuantity?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 32) unit?: string;
}
