import { IsIn, IsInt, IsObject, IsString, IsUUID, Length, Matches, Min } from 'class-validator';

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

export class CorrectIntegrationIdentifierDto {
  @IsUUID() expectedInternalId!: string;
  @IsUUID() newInternalId!: string;
  @IsString() @Length(3, 500) reason!: string;
  @IsInt() @Min(0) observedCount!: number;
}

export class SetIntegrationOwnershipDto {
  @IsIn(['LABOR', 'POS', 'TICKETING', 'INVENTORY', 'EVENT'])
  domain!: 'LABOR' | 'POS' | 'TICKETING' | 'INVENTORY' | 'EVENT';

  @IsString()
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/)
  source!: string;
}

export class SaveIntegrationTransformDto {
  @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/) source!: string;
  @IsObject() definition!: Record<string, unknown>;
}
