import { Body, ConflictException, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { CaptureVenueTemplateDto, CreateEventDto, CreateLocationDto, CreateOperationalTaskDto, CreateVenueDepartmentDto, CreateVenueServiceAreaDto, CreateVenueDto, PreviewVenueEventDto, SetLocationServiceAreaDto, SetPersonActiveDto, UpdateEventDto, UpdateLocationDto, UpdateOperationalTaskDto, UpdateOrganizationDto, UpdateVenueDto, UpdateVenueLifecycleDto, UpsertPersonDto } from './operations.dto';
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
  @Put('admin/organization') updateOrganization(@Req() request: Request, @Body() dto: UpdateOrganizationDto, @Headers('idempotency-key') key: string) { return this.operations.updateOrganization(request.identity, dto.name, this.key(key)); }
  @Post('admin/venues') createVenue(@Req() request: Request, @Body() dto: CreateVenueDto, @Headers('idempotency-key') key: string) { return this.operations.createVenue(request.identity, dto, this.key(key)); }
  @Put('admin/venues/:venueId') updateVenue(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: UpdateVenueDto, @Headers('idempotency-key') key: string) { return this.operations.updateVenue(request.identity, venueId, dto, this.key(key)); }
  @Get('admin/venues/:venueId/readiness') venueReadiness(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string) { return this.operations.venueReadiness(request.identity, venueId); }
  @Put('admin/venues/:venueId/lifecycle') updateVenueLifecycle(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: UpdateVenueLifecycleDto, @Headers('idempotency-key') key: string) { return this.operations.updateVenueLifecycle(request.identity, venueId, dto.action, this.key(key)); }
  @Post('admin/venues/:venueId/notice-recipients') assignVenueNoticeRecipient(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: { subject: string }, @Headers('idempotency-key') key: string) { return this.operations.assignVenueNoticeRecipient(request.identity, venueId, dto.subject, this.key(key)); }
  @Post('admin/locations') createLocation(@Req() request: Request, @Body() dto: CreateLocationDto, @Headers('idempotency-key') key: string) { return this.operations.createLocation(request.identity, dto, this.key(key)); }
  @Put('admin/locations/:locationId') updateLocation(@Req() request: Request, @Param('locationId', new ParseUUIDPipe()) locationId: string, @Body() dto: UpdateLocationDto, @Headers('idempotency-key') key: string) { return this.operations.updateLocation(request.identity, locationId, dto, this.key(key)); }
  @Get('admin/venues/:venueId/structure') venueStructure(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string) { return this.operations.venueStructure(request.identity, venueId); }
  @Get('admin/venues/:venueId/onboarding') venueOnboarding(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string) { return this.operations.venueOnboarding(request.identity, venueId); }
  @Post('admin/venues/:venueId/event-preview') previewVenueEvent(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: PreviewVenueEventDto) { return this.operations.previewVenueEvent(request.identity, venueId, dto); }
  @Post('admin/venues/:venueId/departments') createVenueDepartment(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: CreateVenueDepartmentDto, @Headers('idempotency-key') key: string) { return this.operations.createVenueDepartment(request.identity, venueId, dto, this.key(key)); }
  @Post('admin/venues/:venueId/service-areas') createVenueServiceArea(@Req() request: Request, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Body() dto: CreateVenueServiceAreaDto, @Headers('idempotency-key') key: string) { return this.operations.createVenueServiceArea(request.identity, venueId, dto, this.key(key)); }
  @Put('admin/locations/:locationId/service-area') setLocationServiceArea(@Req() request: Request, @Param('locationId', new ParseUUIDPipe()) locationId: string, @Body() dto: SetLocationServiceAreaDto, @Headers('idempotency-key') key: string) { return this.operations.setLocationServiceArea(request.identity, locationId, dto, this.key(key)); }
  @Get('admin/venue-templates') venueTemplates(@Req() request: Request) { return this.operations.venueTemplates(request.identity); }
  @Post('admin/venue-templates') captureVenueTemplate(@Req() request: Request, @Body() dto: CaptureVenueTemplateDto, @Headers('idempotency-key') key: string) { return this.operations.captureVenueTemplate(request.identity, dto, this.key(key)); }
  @Get('admin/venue-templates/:templateId/preview/:venueId') previewVenueTemplate(@Req() request: Request, @Param('templateId', new ParseUUIDPipe()) templateId: string, @Param('venueId', new ParseUUIDPipe()) venueId: string) { return this.operations.previewVenueTemplate(request.identity, templateId, venueId); }
  @Post('admin/venue-templates/:templateId/apply/:venueId') applyVenueTemplate(@Req() request: Request, @Param('templateId', new ParseUUIDPipe()) templateId: string, @Param('venueId', new ParseUUIDPipe()) venueId: string, @Headers('idempotency-key') key: string) { return this.operations.applyVenueTemplate(request.identity, templateId, venueId, this.key(key)); }
  @Post('admin/events') createEvent(@Req() request: Request, @Body() dto: CreateEventDto, @Headers('idempotency-key') key: string) { return this.operations.createEvent(request.identity, dto, this.key(key)); }
  @Put('admin/events/:eventId') updateEvent(@Req() request: Request, @Param('eventId', new ParseUUIDPipe()) eventId: string, @Body() dto: UpdateEventDto, @Headers('idempotency-key') key: string) { return this.operations.updateEvent(request.identity, eventId, dto, this.key(key)); }
  @Post('admin/people') upsertPerson(@Req() request: Request, @Body() dto: UpsertPersonDto, @Headers('idempotency-key') key: string) { return this.operations.upsertPerson(request.identity, dto, this.key(key)); }
  @Put('admin/people/:personId/status') setPersonActive(@Req() request: Request, @Param('personId', new ParseUUIDPipe()) personId: string, @Body() dto: SetPersonActiveDto, @Headers('idempotency-key') key: string) { return this.operations.setPersonActive(request.identity, personId, dto.active, this.key(key)); }
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
