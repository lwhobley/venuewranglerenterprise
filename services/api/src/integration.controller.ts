import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, RawBodyRequest, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { IntegrationService } from './integration.service';
import { PutIntegrationIdentifierDto } from './integration.dto';

@Controller('v1/integrations')
export class IntegrationController {
  constructor(private readonly integrations: IntegrationService) {}

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
