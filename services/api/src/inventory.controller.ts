import { Body, ConflictException, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { ApproveStockCountDto, CreateStockItemDto, RecordStockCountDto, StartStockCountDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Inventory counts')
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}
  @Get('inventory/items') items(@Req() req: Request, @Query('venueId', new ParseUUIDPipe()) venueId: string, @Query('locationId') locationId?: string) { return this.inventory.listItems(req.identity, venueId, locationId); }
  @Post('admin/inventory/items') createItem(@Req() req: Request, @Body() dto: CreateStockItemDto, @Headers('idempotency-key') key: string) { return this.inventory.createItem(req.identity, dto, this.key(key)); }
  @Get('events/:eventId/inventory/counts') counts(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) { return this.inventory.listCounts(req.identity, eventId); }
  @Post('events/:eventId/inventory/counts') start(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: StartStockCountDto, @Headers('idempotency-key') key: string) { return this.inventory.startCount(req.identity, eventId, dto, this.key(key)); }
  @Put('events/:eventId/inventory/counts/:countId/lines/:lineId') record(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('countId', new ParseUUIDPipe()) countId: string, @Param('lineId', new ParseUUIDPipe()) lineId: string, @Body() dto: RecordStockCountDto, @Headers('idempotency-key') key: string) { return this.inventory.recordCount(req.identity, eventId, countId, lineId, dto, this.key(key)); }
  @Post('events/:eventId/inventory/counts/:countId/submit') submit(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('countId', new ParseUUIDPipe()) countId: string, @Headers('idempotency-key') key: string) { return this.inventory.submit(req.identity, eventId, countId, this.key(key)); }
  @Post('events/:eventId/inventory/counts/:countId/approve') approve(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('countId', new ParseUUIDPipe()) countId: string, @Body() dto: ApproveStockCountDto, @Headers('idempotency-key') key: string) { return this.inventory.approve(req.identity, eventId, countId, dto, this.key(key)); }
  private key(key?: string) { if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.'); return key; }
}
