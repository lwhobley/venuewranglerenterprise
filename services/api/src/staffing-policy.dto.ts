import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class UpdateStaffingPolicyDto {
  @ApiProperty({ minimum: 0, maximum: 1440, description: 'Required rest between assigned shifts, in minutes. Zero disables the additional gap rule.' })
  @IsInt() @Min(0) @Max(1440) minimumRestMinutes!: number;
}
