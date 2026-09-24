import { Body, Controller, Delete, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { RegisterPushDeviceDto } from './push-devices.dto';
import { PushDevicesService } from './push-devices.service';

@Controller('v1/me/push-devices')
@UseGuards(JwtIdentityGuard)
@ApiTags('Push notifications')
@ApiBearerAuth()
export class PushDevicesController {
  constructor(private readonly devices: PushDevicesService) {}

  @Post()
  register(@Req() request: Request, @Body() dto: RegisterPushDeviceDto) {
    return this.devices.register(request.identity, dto);
  }

  @Delete(':installationId')
  revoke(@Req() request: Request, @Param('installationId', new ParseUUIDPipe()) installationId: string) {
    return this.devices.revoke(request.identity, installationId);
  }
}
