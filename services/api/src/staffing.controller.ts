import { BadRequestException, Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { StaffingService } from './staffing.service';
import { CreateStaffShiftDto, RespondToShiftDto, UpdateStaffShiftDto } from './staffing.dto';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Staffing')
@ApiBearerAuth()
export class StaffingController {
  constructor(private readonly staffing: StaffingService) {}

  @Get('events/:eventId/shifts') list(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string) {
    return this.staffing.list(req.identity, eventId);
  }
  @Post('events/:eventId/shifts') create(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: CreateStaffShiftDto, @Headers('idempotency-key') key: string) {
    return this.staffing.create(req.identity, eventId, dto, this.key(key));
  }
  @Put('events/:eventId/shifts/:shiftId') update(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Body() dto: UpdateStaffShiftDto, @Headers('idempotency-key') key: string) {
    return this.staffing.update(req.identity, eventId, shiftId, dto, this.key(key));
  }
  @Post('events/:eventId/shifts/:shiftId/publish') publish(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Headers('idempotency-key') key: string) {
    return this.staffing.publish(req.identity, eventId, shiftId, this.key(key));
  }
  @Post('events/:eventId/shifts/:shiftId/cancel') cancel(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Headers('idempotency-key') key: string) {
    return this.staffing.cancel(req.identity, eventId, shiftId, this.key(key));
  }
  @Post('events/:eventId/shifts/:shiftId/claim') claim(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Headers('idempotency-key') key: string) {
    return this.staffing.claim(req.identity, eventId, shiftId, this.key(key));
  }
  @Post('events/:eventId/shifts/:shiftId/response') respond(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Body() dto: RespondToShiftDto, @Headers('idempotency-key') key: string) {
    return this.staffing.respond(req.identity, eventId, shiftId, dto, this.key(key));
  }
  @Post('events/:eventId/shifts/:shiftId/check-in') checkIn(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Headers('idempotency-key') key: string) {
    return this.staffing.attendance(req.identity, eventId, shiftId, 'check-in', this.key(key));
  }
  @Post('events/:eventId/shifts/:shiftId/check-out') checkOut(@Req() req: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Param('shiftId', new ParseUUIDPipe()) shiftId: string, @Headers('idempotency-key') key: string) {
    return this.staffing.attendance(req.identity, eventId, shiftId, 'check-out', this.key(key));
  }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new BadRequestException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
