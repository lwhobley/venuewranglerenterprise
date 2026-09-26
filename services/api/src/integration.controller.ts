import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { IntegrationService } from './integration.service';
import { CorrectIntegrationIdentifierDto, PutIntegrationIdentifierDto, SaveIntegrationTransformDto, SetIntegrationOwnershipDto } from './integration.dto';

@Controller('v1/integrations')
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

  @Get('sources')
  @UseGuards(JwtIdentityGuard)
  sources(@Req() request: Request) {
    return this.integrations.sources(request.identity);
  }

  @Post('sources/:sourceId/poll')
  @UseGuards(JwtIdentityGuard)
  poll(@Req() request: Request, @Param('sourceId') sourceId: string) {
    return this.integrations.poll(request.identity, sourceId);
  }

  @Get('sources/:sourceId/dead-letters')
  @UseGuards(JwtIdentityGuard)
  deadLetters(@Req() request: Request, @Param('sourceId') sourceId: string) {
    return this.integrations.deadLetters(request.identity, sourceId);
  }

  @Post('dead-letters/:letterId/replay')
  @UseGuards(JwtIdentityGuard)
  replay(@Req() request: Request, @Param('letterId', new ParseUUIDPipe()) letterId: string) {
    return this.integrations.replayDeadLetter(request.identity, letterId);
  }

  @Get('ownership')
  @UseGuards(JwtIdentityGuard)
  ownership(@Req() request: Request) { return this.integrations.ownership(request.identity); }

  @Put('ownership')
  @UseGuards(JwtIdentityGuard)
  setOwnership(@Req() request: Request, @Body() dto: SetIntegrationOwnershipDto) { return this.integrations.setOwnership(request.identity, dto); }

  @Post('preview')
  @UseGuards(JwtIdentityGuard)
  preview(@Req() request: Request, @Body() body: unknown) {
    return this.integrations.preview(request.identity, body);
  }

  @Get('transforms')
  @UseGuards(JwtIdentityGuard)
  transforms(@Req() request: Request) { return this.integrations.transforms(request.identity); }

  @Post('transforms')
  @UseGuards(JwtIdentityGuard)
  saveTransform(@Req() request: Request, @Body() dto: SaveIntegrationTransformDto) { return this.integrations.saveTransform(request.identity, dto); }

  @Post('transforms/preview')
  @UseGuards(JwtIdentityGuard)
  previewRaw(@Req() request: Request, @Body() body: unknown) { return this.integrations.previewRaw(request.identity, body); }

  @Post('raw')
  ingestRaw(@Headers('x-integration-id') providerId: string | undefined,
    @Headers('x-integration-timestamp') timestamp: string | undefined,
    @Headers('x-integration-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>) {
    return this.integrations.ingestRaw(providerId, timestamp, signature, request.rawBody, request.body);
  }

  @Get('identifiers')
  @UseGuards(JwtIdentityGuard)
  identifiers(@Req() request: Request) {
    return this.integrations.identifiers(request.identity);
  }

  @Put('identifiers')
  @UseGuards(JwtIdentityGuard)
  putIdentifier(@Req() request: Request, @Body() dto: PutIntegrationIdentifierDto) {
    return this.integrations.putIdentifier(request.identity, dto);
  }

  @Get('identifiers/:mappingId/impact')
  @UseGuards(JwtIdentityGuard)
  identifierImpact(@Req() request: Request, @Param('mappingId', new ParseUUIDPipe()) mappingId: string) {
    return this.integrations.identifierImpact(request.identity, mappingId);
  }

  @Put('identifiers/:mappingId/correct')
  @UseGuards(JwtIdentityGuard)
  correctIdentifier(@Req() request: Request, @Param('mappingId', new ParseUUIDPipe()) mappingId: string, @Body() dto: CorrectIntegrationIdentifierDto) {
    return this.integrations.correctIdentifier(request.identity, mappingId, dto);
  }

  @Post('events')
  ingest(
    @Headers('x-integration-id') providerId: string | undefined,
    @Headers('x-integration-timestamp') timestamp: string | undefined,
    @Headers('x-integration-signature') signature: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.integrations.ingest(providerId, timestamp, signature, request.rawBody, request.body);
  }

  @Get('events/:eventId')
  @UseGuards(JwtIdentityGuard)
  list(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.integrations.list(request.identity, eventId);
  }
}
