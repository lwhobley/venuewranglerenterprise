import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtIdentityGuard } from './auth';
import { IssuesController } from './issues.controller';
import { HealthController } from './health.controller';
import { IssuesService } from './issues.service';
import { PrismaService } from './prisma.service';
import { AuthController } from './auth.controller';
import { AuthProvidersService } from './auth-providers';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EvidenceService } from './evidence.service';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';
import { PushDevicesController } from './push-devices.controller';
import { PushDevicesService } from './push-devices.service';
import { PushNotificationsService } from './push-notifications.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { StaffingController } from './staffing.controller';
import { StaffingService } from './staffing.service';
import { StaffAvailabilityController } from './staff-availability.controller';
import { StaffAvailabilityService } from './staff-availability.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { HospitalityController } from './hospitality.controller';
import { HospitalityService } from './hospitality.service';
import { CloseoutController } from './closeout.controller';
import { CloseoutService } from './closeout.service';
import { VendorStaffingController } from './vendor-staffing.controller';
import { VendorStaffingService } from './vendor-staffing.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: (env) => {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    if (env.NODE_ENV === 'production') {
      if (!env.SSO_PROVIDERS_JSON) throw new Error('SSO_PROVIDERS_JSON must configure at least one enterprise identity provider in production.');
      if (!env.EVIDENCE_BUCKET) throw new Error('EVIDENCE_BUCKET must name the private Cloud Storage bucket used for issue evidence in production.');
    } else if (!env.JWT_HS256_SECRET || env.JWT_HS256_SECRET.length < 32) {
      throw new Error('JWT_HS256_SECRET must contain at least 32 characters for local development.');
    }
    return env;
  } })],
  controllers: [AuthController, HealthController, IssuesController, OperationsController, StaffingController, StaffAvailabilityController, InventoryController, HospitalityController, CloseoutController, VendorStaffingController, NotificationsController, ScimController, IntegrationController, PushDevicesController, AuditController],
  providers: [AuthProvidersService, PrismaService, JwtIdentityGuard, IssuesService, OperationsService, StaffingService, StaffAvailabilityService, InventoryService, HospitalityService, CloseoutService, VendorStaffingService, NotificationsService, EvidenceService, ScimService, IntegrationService, PushDevicesService, PushNotificationsService, AuditService],
})
export class AppModule {}
