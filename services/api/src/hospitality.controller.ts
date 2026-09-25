import { Body, ConflictException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateHospitalityMenuItemDto, CreateHospitalityOrderDto, HospitalityOrderActionDto, UpdateHospitalityPolicyDto } from './hospitality.dto';
import { HospitalityService } from './hospitality.service';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Hospitality orders and menu')
@ApiBearerAuth()
export class HospitalityController {
  constructor(private readonly hospitality: HospitalityService) {}

  @Get('venues/:venueId/hospitality/menu-items')
  listMenuItems(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string) {
    return this.hospitality.listMenuItems(req.identity, venueId);
  }

  @Post('admin/venues/:venueId/hospitality/menu-items')
  createMenuItem(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: CreateHospitalityMenuItemDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.createMenuItem(req.identity, { ...dto, venueId }, this.key(key));
  }

  @Get('admin/hospitality-policy')
  getHospitalityPolicy(@Req() req: Request) {
    return this.hospitality.getHospitalityPolicy(req.identity);
  }

  @Put('admin/hospitality-policy')
  updateHospitalityPolicy(@Req() req: Request, @Body() dto: UpdateHospitalityPolicyDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.updateHospitalityPolicy(req.identity, dto, this.key(key));
  }

  @Get('events/:eventId/hospitality/orders')
  list(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.hospitality.list(req.identity, eventId);
  }

  @Post('events/:eventId/hospitality/orders')
  create(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: CreateHospitalityOrderDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.create(req.identity, eventId, dto, this.key(key));
  }

  @Post('events/:eventId/hospitality/orders/:orderId/actions')
  act(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: HospitalityOrderActionDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.act(req.identity, eventId, orderId, dto, this.key(key));
  }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
