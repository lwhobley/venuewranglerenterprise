import { IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateCloseoutFollowupDto {
  @IsIn(['ISSUE', 'TASK', 'ATTENDANCE', 'HOSPITALITY', 'STOCK_COUNT', 'STOCK_TRANSFER', 'VENDOR_REQUEST']) sourceType!: 'ISSUE' | 'TASK' | 'ATTENDANCE' | 'HOSPITALITY' | 'STOCK_COUNT' | 'STOCK_TRANSFER' | 'VENDOR_REQUEST';
  @IsString() @MinLength(1) @MaxLength(80) sourceId!: string;
  @IsIn(['FOLLOW_UP', 'ACCEPTED', 'DONE']) state!: 'FOLLOW_UP' | 'ACCEPTED' | 'DONE';
  @IsOptional() @IsString() @MaxLength(512) ownerSubject?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class UpdateCloseoutSummaryDto {
  @IsString() @MaxLength(2000) summary!: string;
}
