import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtIdentityGuard } from './auth';
import { IssuesController } from './issues.controller';
import { HealthController } from './health.controller';
import { IssuesService } from './issues.service';
import { PrismaService } from './prisma.service';
import { AuthController } from './auth.controller';
import { AuthProvidersService } from './auth-providers';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: (env) => {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    if (env.NODE_ENV === 'production') {
      if (!env.SSO_PROVIDERS_JSON) throw new Error('SSO_PROVIDERS_JSON must configure at least one enterprise identity provider in production.');
    } else if (!env.JWT_HS256_SECRET || env.JWT_HS256_SECRET.length < 32) {
      throw new Error('JWT_HS256_SECRET must contain at least 32 characters for local development.');
    }
    return env;
  } })],
  controllers: [AuthController, HealthController, IssuesController],
  providers: [AuthProvidersService, PrismaService, JwtIdentityGuard, IssuesService],
})
export class AppModule {}
