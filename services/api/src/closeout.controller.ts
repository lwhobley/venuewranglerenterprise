import { Body, ConflictException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CloseoutService } from './closeout.service';
import { UpdateCloseoutFollowupDto, UpdateCloseoutSummaryDto } from './closeout.dto';

@Controller('v1/events/:eventId/closeout')
@UseGuards(JwtIdentityGuard)
@ApiTags('Event closeout')
@ApiBearerAuth()
export class CloseoutController {
  constructor(private readonly closeout: CloseoutService) {}

  @Get() overview(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.closeout.overview(request.identity, eventId);
  }
  @Post() open(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Headers('idempotency-key') key: string) {
    return this.closeout.open(request.identity, eventId, this.key(key));
  }
  @Put('followups') updateFollowup(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: UpdateCloseoutFollowupDto, @Headers('idempotency-key') key: string) {
    return this.closeout.updateFollowup(request.identity, eventId, dto, this.key(key));
  }
  @Put('summary') updateSummary(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: UpdateCloseoutSummaryDto, @Headers('idempotency-key') key: string) {
    return this.closeout.updateSummary(request.identity, eventId, dto.summary, this.key(key));
  }
  @Post('finalize') finalize(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Headers('idempotency-key') key: string) {
    return this.closeout.finalize(request.identity, eventId, this.key(key));
  }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
