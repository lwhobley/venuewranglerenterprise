import { Body, ConflictException, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDto, UpdateOperationalTaskDto, UpsertPersonDto } from './operations.dto';
import { OperationsService } from './operations.service';
import { GrantPersonQualificationDto } from './qualification.dto';
import { UpdateStaffingPolicyDto } from './staffing-policy.dto';
import { CreateQualificationEvidenceDto, ReviewQualificationEvidenceDto } from './evidence.dto';
import { EvidenceService } from './evidence.service';

@Controller('v1')
@UseGuards(JwtIdentityGuard)
@ApiTags('Operations and tenant setup')
@ApiBearerAuth()
export class OperationsController {
  constructor(private readonly operations: OperationsService, private readonly evidence: EvidenceService) {}

  @Get('me') bootstrap(@Req() request: Request) {
    return this.operations.bootstrap(request.identity, { email: request.identity.email, name: request.identity.displayName });
  }
  @Post('admin/venues') createVenue(@Req() request: Request, @Body() dto: CreateVenueDto, @Headers('idempotency-key') key: string) { return this.operations.createVenue(request.identity, dto, this.key(key)); }
  @Post('admin/locations') createLocation(@Req() request: Request, @Body() dto: CreateLocationDto, @Headers('idempotency-key') key: string) { return this.operations.createLocation(request.identity, dto, this.key(key)); }
  @Post('admin/events') createEvent(@Req() request: Request, @Body() dto: CreateEventDto, @Headers('idempotency-key') key: string) { return this.operations.createEvent(request.identity, dto, this.key(key)); }
  @Post('admin/people') upsertPerson(@Req() request: Request, @Body() dto: UpsertPersonDto, @Headers('idempotency-key') key: string) { return this.operations.upsertPerson(request.identity, dto, this.key(key)); }
  @Get('admin/people/:personId/qualifications') personQualifications(@Req() request: Request, @Param('personId', new ParseUUIDPipe()) personId: string) { return this.operations.personQualifications(request.identity, personId); }
  @Post('admin/people/:personId/qualifications') grantPersonQualification(@Req() request: Request, @Param('personId', new ParseUUIDPipe()) personId: string, @Body() dto: GrantPersonQualificationDto, @Headers('idempotency-key') key: string) { return this.operations.grantPersonQualification(request.identity, personId, dto, this.key(key)); }
  @Post('admin/qualifications/:qualificationId/evidence') createQualificationEvidence(@Req() request: Request, @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string, @Body() dto: CreateQualificationEvidenceDto) { return this.evidence.createQualificationEvidence(request.identity, qualificationId, dto); }
  @Post('admin/qualifications/:qualificationId/evidence/complete') completeQualificationEvidence(@Req() request: Request, @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string) { return this.evidence.completeQualificationEvidence(request.identity, qualificationId); }
  @Get('admin/qualifications/:qualificationId/evidence/download') qualificationEvidenceDownload(@Req() request: Request, @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string) { return this.evidence.qualificationEvidenceDownload(request.identity, qualificationId); }
  @Put('admin/qualifications/:qualificationId/evidence/review') reviewQualificationEvidence(@Req() request: Request, @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string, @Body() dto: ReviewQualificationEvidenceDto) { return this.evidence.reviewQualificationEvidence(request.identity, qualificationId, dto.status, dto.reason); }
  @Delete('admin/qualifications/:qualificationId') revokePersonQualification(@Req() request: Request, @Param('qualificationId', new ParseUUIDPipe()) qualificationId: string, @Headers('idempotency-key') key: string) { return this.operations.revokePersonQualification(request.identity, qualificationId, this.key(key)); }
  @Get('admin/staffing-policy') staffingPolicy(@Req() request: Request) { return this.operations.staffingPolicy(request.identity); }
  @Put('admin/staffing-policy') updateStaffingPolicy(@Req() request: Request, @Body() dto: UpdateStaffingPolicyDto, @Headers('idempotency-key') key: string) { return this.operations.updateStaffingPolicy(request.identity, dto, this.key(key)); }
  @Get('events/:eventId/tasks') tasks(@Req() request: Request, @Param('eventId') eventId: string) { return this.operations.listTasks(request.identity, eventId); }
  @Post('events/:eventId/tasks') createTask(@Req() request: Request, @Param('eventId') eventId: string, @Body() dto: CreateOperationalTaskDto, @Headers('idempotency-key') key: string) { return this.operations.createTask(request.identity, eventId, dto, this.key(key)); }
  @Put('events/:eventId/tasks/:taskId') updateTask(@Req() request: Request, @Param('eventId') eventId: string, @Param('taskId') taskId: string, @Body() dto: UpdateOperationalTaskDto, @Headers('idempotency-key') key: string) { return this.operations.updateTask(request.identity, eventId, taskId, dto, this.key(key)); }

  private key(key?: string) {
    if (!key || key.length < 16 || key.length > 200) throw new ConflictException('An Idempotency-Key between 16 and 200 characters is required.');
    return key;
  }
}
