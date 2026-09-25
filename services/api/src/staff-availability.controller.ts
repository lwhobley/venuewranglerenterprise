import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateUnavailabilityDto } from './staff-availability.dto';
import { StaffAvailabilityService } from './staff-availability.service';

@Controller('v1/me/unavailability')
@UseGuards(JwtIdentityGuard)
@ApiTags('Staffing')
@ApiBearerAuth()
export class StaffAvailabilityController {
  constructor(private readonly availability: StaffAvailabilityService) {}
  @Get() list(@Req() req: Request) { return this.availability.list(req.identity); }
  @Post() create(@Req() req: Request, @Body() dto: CreateUnavailabilityDto, @Headers('idempotency-key') key: string) {
    return this.availability.create(req.identity, dto, this.key(key));
  }
  @Delete(':id') remove(@Req() req: Request, @Param('id', new ParseUUIDPipe()) id: string, @Headers('idempotency-key') key: string) {
    return this.availability.remove(req.identity, id, this.key(key));
  }
  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new BadRequestException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
