import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';

export class PutIntegrationIdentifierDto {
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/)
  source!: string;

  @IsIn(['VENUE', 'EVENT', 'LOCATION'])
  kind!: 'VENUE' | 'EVENT' | 'LOCATION';

  @IsString()
  @Length(1, 240)
  externalId!: string;

  @IsUUID()
  internalId!: string;
}
