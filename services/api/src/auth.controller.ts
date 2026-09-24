import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { AuthProvidersService } from './auth-providers';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly providers: AuthProvidersService) {}

  @Get('organizations/:organizationSlug/providers')
  providersForOrganization(@Param('organizationSlug') slug: string, @Res() response: Response) {
    const config = this.providers.forOrganization(slug);
    if (!config) throw new NotFoundException('No sign-in providers are configured for this organization.');
    response.setHeader('Cache-Control', 'no-store');
    return response.json(config);
  }
}
