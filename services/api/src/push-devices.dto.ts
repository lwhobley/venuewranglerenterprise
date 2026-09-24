import { IsIn, IsString, IsUUID, Length } from 'class-validator';

export class RegisterPushDeviceDto {
  @IsUUID() installationId!: string;
  @IsIn(['ios', 'android']) platform!: 'ios' | 'android';
  @IsString() @Length(32, 4096) registrationToken!: string;
}
