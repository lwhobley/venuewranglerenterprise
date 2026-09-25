import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateVendorStaffingRequestDto {
  @IsString() demandId!: string;
  @IsString() vendorSubject!: string;
  @IsInt() @Min(1) @Max(500) requestedHeadcount!: number;
  @IsDateString() responseDueAt!: string;
  @IsOptional() @IsString() @MaxLength(1000) instructions?: string;
}

export class RespondVendorStaffingRequestDto {
  @IsString() decision!: 'ACKNOWLEDGED' | 'PARTIALLY_COMMITTED' | 'COMMITTED' | 'DECLINED';
  @IsOptional() @IsInt() @Min(0) @Max(500) committedHeadcount?: number;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class ResolveVendorStaffingRequestDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
