import { IsInt, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateEvidenceUploadDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() clientId!: string;
  @ApiProperty({ maxLength: 200 }) @IsString() @Length(1, 200) fileName!: string;
  @ApiProperty({ enum: ['image/jpeg', 'image/png', 'image/heic', 'image/webp'] }) @IsString() @Length(1, 40) contentType!: string;
  @ApiProperty({ minimum: 1, maximum: 8388608 }) @IsInt() @Min(1) @Max(8388608) sizeBytes!: number;
  @ApiProperty({ pattern: '^[0-9a-f]{64}$' }) @IsString() @Matches(/^[0-9a-f]{64}$/) sha256!: string;
}
