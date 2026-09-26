import { IsBoolean, IsDateString, IsEmail, IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { OperationalTaskKind, OperationalTaskState } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVenueDto { @ApiProperty() @IsString() @Length(2, 120) name!: string; @ApiProperty({ example: 'America/Chicago' }) @IsString() @Length(1, 64) timeZone!: string; }
export class UpdateOrganizationDto { @ApiProperty() @IsString() @Length(2, 160) name!: string; }
export class CreateLocationDto { @ApiProperty() @IsUUID() venueId!: string; @ApiProperty() @IsString() @Length(2, 120) name!: string; }
export class CreateEventDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiProperty() @IsString() @Length(2, 160) name!: string;
  @ApiPropertyOptional({ description: 'Absolute instant with Z or a numeric offset. Do not send a device-local time.' }) @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional({ example: '2026-09-26T19:00', description: 'Wall-clock start in the venue IANA time zone.' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAtLocal?: string;
}
export class UpdateVenueDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string; @ApiPropertyOptional({ example: 'America/Chicago' }) @IsOptional() @IsString() @Length(1, 64) timeZone?: string; }
export class UpdateVenueLifecycleDto { @ApiProperty({ enum: ['activate', 'suspend'] }) @IsIn(['activate', 'suspend']) action!: 'activate' | 'suspend'; }
export class UpdateLocationDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string; }
export class CreateVenueDepartmentDto { @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/) code!: string; @ApiProperty() @IsString() @Length(2, 120) name!: string; }
export class CreateVenueServiceAreaDto { @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/) code!: string; @ApiProperty() @IsString() @Length(2, 120) name!: string; @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string; }
export class SetLocationServiceAreaDto { @ApiPropertyOptional() @IsOptional() @IsUUID() serviceAreaId?: string | null; }
export class CaptureVenueTemplateDto { @ApiProperty() @IsUUID() sourceVenueId!: string; @ApiProperty() @IsString() @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/) code!: string; @ApiProperty() @IsString() @Length(2, 120) name!: string; @ApiPropertyOptional({ example: '19:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) defaultEventStartLocal?: string; }
export class PreviewVenueEventDto { @ApiProperty({ example: '2026-09-26T19:00' }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAtLocal!: string; }
export class UpdateEventDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 160) name?: string;
  @ApiPropertyOptional({ description: 'Absolute instant with Z or a numeric offset. Do not send a device-local time.' }) @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional({ example: '2026-09-26T19:00' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) startsAtLocal?: string;
}
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
