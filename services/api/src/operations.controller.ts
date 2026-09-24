import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDto, UpdateOperationalTaskDto, UpsertPersonDto } from './operations.dto';
import { OperationsService } from './operations.service';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Operations and tenant setup')
@ApiBearerAuth()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('me') bootstrap(@Req() request: Request) {
    return this.operations.bootstrap(request.identity, { email: request.identity.email, name: request.identity.displayName });
  }
  @Post('admin/venues') createVenue(@Req() request: Request, @Body() dto: CreateVenueDto) { return this.operations.createVenue(request.identity, dto); }
  @Post('admin/locations') createLocation(@Req() request: Request, @Body() dto: CreateLocationDto) { return this.operations.createLocation(request.identity, dto); }
  @Post('admin/events') createEvent(@Req() request: Request, @Body() dto: CreateEventDto) { return this.operations.createEvent(request.identity, dto); }
  @Post('admin/people') upsertPerson(@Req() request: Request, @Body() dto: UpsertPersonDto) { return this.operations.upsertPerson(request.identity, dto); }
  @Get('events/:eventId/tasks') tasks(@Req() request: Request, @Param('eventId') eventId: string) { return this.operations.listTasks(request.identity, eventId); }
  @Post('events/:eventId/tasks') createTask(@Req() request: Request, @Param('eventId') eventId: string, @Body() dto: CreateOperationalTaskDto) { return this.operations.createTask(request.identity, eventId, dto); }
  @Put('events/:eventId/tasks/:taskId') updateTask(@Req() request: Request, @Param('eventId') eventId: string, @Param('taskId') taskId: string, @Body() dto: UpdateOperationalTaskDto) { return this.operations.updateTask(request.identity, eventId, taskId, dto); }
}
