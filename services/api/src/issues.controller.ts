import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Param, Post, Req, Sse, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { assertScope, JwtIdentityGuard } from './auth';
import { AssignIssueDto, CreateIssueDto, IssueNoteDto } from './issues.dto';
import { IssuesService } from './issues.service';
import { CreateEvidenceUploadDto } from './evidence.dto';
import { EvidenceService } from './evidence.service';

@Controller('v1/events/:eventId/issues')
@UseGuards(JwtIdentityGuard)
@ApiTags('Issues')
@ApiBearerAuth()
export class IssuesController {
  constructor(private readonly issues: IssuesService, private readonly evidence: EvidenceService) {}
  @Get() list(@Param('eventId') eventId: string, @Req() request: Request) { return this.issues.list(request.identity, eventId); }
  @Post() create(@Param('eventId') eventId: string, @Body() dto: CreateIssueDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.create(request.identity, eventId, dto, this.key(key)); }
  @Post(':issueId/triage') triage(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: IssueNoteDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.triage(request.identity, eventId, issueId, dto, this.key(key)); }
  @Post(':issueId/assign') assign(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: AssignIssueDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.assign(request.identity, eventId, issueId, dto, this.key(key)); }
  @Post(':issueId/escalate') escalate(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: IssueNoteDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.escalate(request.identity, eventId, issueId, dto, this.key(key)); }
  @Post(':issueId/resolve') resolve(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: IssueNoteDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.resolve(request.identity, eventId, issueId, dto, this.key(key)); }
  @Post(':issueId/verify') verify(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: IssueNoteDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.verify(request.identity, eventId, issueId, dto, this.key(key)); }
  @Post(':issueId/close') close(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: IssueNoteDto, @Headers('idempotency-key') key: string, @Req() request: Request) { return this.issues.close(request.identity, eventId, issueId, dto, this.key(key)); }
  @Post(':issueId/evidence') createEvidenceUpload(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Body() dto: CreateEvidenceUploadDto, @Req() request: Request) { return this.evidence.createUpload(request.identity, eventId, issueId, dto); }
  @Post(':issueId/evidence/:attachmentId/complete') completeEvidenceUpload(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Param('attachmentId') attachmentId: string, @Req() request: Request) { return this.evidence.completeUpload(request.identity, eventId, issueId, attachmentId); }
  @Get(':issueId/evidence') listEvidence(@Param('eventId') eventId: string, @Param('issueId') issueId: string, @Req() request: Request) { return this.evidence.list(request.identity, eventId, issueId); }
  @Sse('stream') stream(@Param('eventId') eventId: string, @Req() request: Request) {
    assertScope(request.identity, 'issue:read', eventId);
    const lastEventId = request.header('last-event-id') ?? '0';
    if (!/^\d+$/.test(lastEventId)) throw new BadRequestException('Last-Event-ID must be a non-negative integer.');
    return this.issues.stream(request.identity, eventId, lastEventId);
  }
  private key(key?: string) { if (!key || key.length < 16) throw new ConflictException('An Idempotency-Key is required.'); return key; }
}
