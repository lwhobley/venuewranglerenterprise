import { Body, ConflictException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateHospitalityMenuItemDto, CreateHospitalityOrderDto, HospitalityOrderActionDto, SetHospitalityMenuItemStatusDto, SetHospitalityMenuRecipeDto, UpdateHospitalityPolicyDto } from './hospitality.dto';
import { HospitalityService } from './hospitality.service';
import { EvidenceService } from './evidence.service';
import { CreateEvidenceUploadDto } from './evidence.dto';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Hospitality orders and menu')
@ApiBearerAuth()
export class HospitalityController {
  constructor(private readonly hospitality: HospitalityService, private readonly evidence: EvidenceService) {}

  @Get('venues/:venueId/hospitality/menu-items')
  listMenuItems(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string) {
    return this.hospitality.listMenuItems(req.identity, venueId);
  }

  @Get('admin/venues/:venueId/hospitality/menu-items')
  listAdminMenuItems(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string) {
    return this.hospitality.listMenuItems(req.identity, venueId, true);
  }

  @Post('admin/venues/:venueId/hospitality/menu-items')
  createMenuItem(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: CreateHospitalityMenuItemDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.createMenuItem(req.identity, { ...dto, venueId }, this.key(key));
  }

  @Put('admin/venues/:venueId/hospitality/menu-items/:itemId')
  setMenuItemStatus(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Param('itemId', new ParseUUIDPipe()) itemId: string, @Body() dto: SetHospitalityMenuItemStatusDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.setMenuItemStatus(req.identity, venueId, itemId, dto.active, this.key(key));
  }

  @Get('admin/venues/:venueId/hospitality/menu-items/:itemId/recipe')
  getMenuRecipe(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Param('itemId', new ParseUUIDPipe()) itemId: string) {
    return this.hospitality.getMenuRecipe(req.identity, venueId, itemId);
  }

  @Put('admin/venues/:venueId/hospitality/menu-items/:itemId/recipe')
  setMenuRecipe(@Req() req: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Param('itemId', new ParseUUIDPipe()) itemId: string, @Body() dto: SetHospitalityMenuRecipeDto, @Headers('idempotency-key') key: string) {
    return this.hospitality.setMenuRecipe(req.identity, venueId, itemId, dto, this.key(key));
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

  @Post('events/:eventId/hospitality/orders/:orderId/receipt-evidence')
  createReceiptEvidenceUpload(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Body() dto: CreateEvidenceUploadDto) {
    return this.evidence.createHospitalityDeliveryUpload(req.identity, eventId, orderId, dto);
  }

  @Post('events/:eventId/hospitality/orders/:orderId/receipt-evidence/:evidenceId/complete')
  completeReceiptEvidenceUpload(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string) {
    return this.evidence.completeHospitalityDeliveryUpload(req.identity, eventId, orderId, evidenceId);
  }

  @Get('events/:eventId/hospitality/orders/:orderId/receipt-evidence/:evidenceId/download')
  downloadReceiptEvidence(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('orderId', new ParseUUIDPipe()) orderId: string, @Param('evidenceId', new ParseUUIDPipe()) evidenceId: string) {
    return this.evidence.hospitalityDeliveryDownload(req.identity, eventId, orderId, evidenceId);
  }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
