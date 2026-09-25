import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Length, Matches } from 'class-validator';

export class GrantPersonQualificationDto {
  @ApiProperty({ example: 'FOOD_HANDLER' }) @IsString() @Length(2, 40) @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/) code!: string;
  @ApiProperty({ example: 'Food handler certification' }) @IsString() @Length(2, 120) name!: string;
  @ApiPropertyOptional({ description: 'Last valid calendar day in ISO YYYY-MM-DD format.' }) @IsOptional() @IsDateString() expiresAt?: string;
}
