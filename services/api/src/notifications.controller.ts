import { Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { NotificationsService } from './notifications.service';

@Controller('v1/me/notifications')
@UseGuards(JwtIdentityGuard)
@ApiTags('Notifications')
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get() list(@Req() request: Request) {
    return this.notifications.list(request.identity);
  }

  @Post(':notificationId/read') markRead(@Req() request: Request, @Param('notificationId', new ParseUUIDPipe()) id: string) {
    return this.notifications.markRead(request.identity, id);
  }
}
