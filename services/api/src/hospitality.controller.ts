import { Body, ConflictException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateHospitalityOrderDto, HospitalityOrderActionDto } from './hospitality.dto';
import { HospitalityService } from './hospitality.service';

@Controller('v1/events/:eventId/hospitality/orders')
@UseGuards(JwtIdentityGuard)
@ApiTags('Hospitality orders')
@ApiBearerAuth()
export class HospitalityController {
  constructor(private readonly hospitality: HospitalityService) {}
  @Get() list(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.hospitality.list(req.identity, eventId);
  }
  @Post() create(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: CreateHospitalityOrderDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.create(req.identity, eventId, dto, this.key(key));
  }
  @Post(':orderId/actions') act(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: HospitalityOrderActionDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.act(req.identity, eventId, orderId, dto, this.key(key));
  }
  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
