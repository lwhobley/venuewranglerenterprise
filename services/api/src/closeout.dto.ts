import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateCloseoutFollowupDto {
  @IsIn(['ISSUE', 'TASK', 'ATTENDANCE', 'HOSPITALITY', 'STOCK_COUNT', 'STOCK_TRANSFER', 'VENDOR_REQUEST']) sourceType!: 'ISSUE' | 'TASK' | 'ATTENDANCE' | 'HOSPITALITY' | 'STOCK_COUNT' | 'STOCK_TRANSFER' | 'VENDOR_REQUEST';
  @IsUUID() sourceId!: string;
  @IsIn(['FOLLOW_UP', 'ACCEPTED', 'DONE']) state!: 'FOLLOW_UP' | 'ACCEPTED' | 'DONE';
  @IsOptional() @IsString() @MaxLength(512) ownerSubject?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class UpdateCloseoutSummaryDto {
  @IsString() @MaxLength(2000) summary!: string;
}

export class CreatePostCloseCorrectionDto {
  @IsIn(['EVENT', 'ISSUE', 'TASK', 'ATTENDANCE', 'HOSPITALITY', 'STOCK_COUNT', 'STOCK_TRANSFER', 'VENDOR_REQUEST']) sourceType!: 'EVENT' | 'ISSUE' | 'TASK' | 'ATTENDANCE' | 'HOSPITALITY' | 'STOCK_COUNT' | 'STOCK_TRANSFER' | 'VENDOR_REQUEST';
  @IsUUID() sourceId!: string;
  @IsString() @MinLength(1) @MaxLength(240) headline!: string;
  @IsString() @MinLength(1) @MaxLength(4000) correction!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
