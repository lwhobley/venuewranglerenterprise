import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from './auth/public.decorator';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @SkipThrottle()
  @Public()
  @Get()
  root() {
    return {
      message: 'Venue Wrangler API is running',
      health: '/api/health',
    };
  }

  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      service: 'venue-wrangler-api',
      time: new Date().toISOString(),
    };
  }
}
