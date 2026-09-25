import { Body, ConflictException, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDto, UpdateOperationalTaskDto, UpsertPersonDto } from './operations.dto';
import { OperationsService } from './operations.service';
import { GrantPersonQualificationDto } from './qualification.dto';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Operations and tenant setup')
@ApiBearerAuth()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('me') bootstrap(@Req() request: Request) {
    return this.operations.bootstrap(request.identity, { email: request.identity.email, name: request.identity.displayName });
  }
  @Post('admin/venues') createVenue(@Req() request: Request, @Body() dto: CreateVenueDto, @Headers('idempotency-key') key: string) { return this.operations.createVenue(request.identity, dto, this.key(key)); }
  @Post('admin/locations') createLocation(@Req() request: Request, @Body() dto: CreateLocationDto, @Headers('idempotency-key') key: string) { return this.operations.createLocation(request.identity, dto, this.key(key)); }
  @Post('admin/events') createEvent(@Req() request: Request, @Body() dto: CreateEventDto, @Headers('idempotency-key') key: string) { return this.operations.createEvent(request.identity, dto, this.key(key)); }
  @Post('admin/people') upsertPerson(@Req() request: Request, @Body() dto: UpsertPersonDto, @Headers('idempotency-key') key: string) { return this.operations.upsertPerson(request.identity, dto, this.key(key)); }
  @Get('admin/people/:personId/qualifications') personQualifications(@Req() request: Request, @Param('personId', new ParseUUIDPipe()) personId: string) { return this.operations.personQualifications(request.identity, personId); }
  @Post('admin/people/:personId/qualifications') grantPersonQualification(@Req() request: Request, @Param('personId', new ParseUUIDPipe()) personId: string, @Body() dto: GrantPersonQualificationDto, @Headers('idempotency-key') key: string) { return this.operations.grantPersonQualification(request.identity, personId, dto, this.key(key)); }
  @Delete('admin/qualifications/:qualificationId') revokePersonQualification(@Req() request: Request, @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string, @Headers('idempotency-key') key: string) { return this.operations.revokePersonQualification(request.identity, qualificationId, this.key(key)); }
  @Get('events/:eventId/tasks') tasks(@Req() request: Request, @Param('eventId') eventId: string) { return this.operations.listTasks(request.identity, eventId); }
  @Post('events/:eventId/tasks') createTask(@Req() request: Request, @Param('eventId') eventId: string, @Body() dto: CreateOperationalTaskDto, @Headers('idempotency-key') key: string) { return this.operations.createTask(request.identity, eventId, dto, this.key(key)); }
  @Put('events/:eventId/tasks/:taskId') updateTask(@Req() request: Request, @Param('eventId') eventId: string, @Param('taskId') taskId: string, @Body() dto: UpdateOperationalTaskDto, @Headers('idempotency-key') key: string) { return this.operations.updateTask(request.identity, eventId, taskId, dto, this.key(key)); }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
