import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';
import { Request } from 'express';
import { JwtIdentityGuard } from './auth';
import { SupportAccessService } from './support-access.service';

class EnterSupportVenueDto {
  @ApiProperty() @IsUUID() venueId!: string;
  @ApiProperty({ description: 'Ticket number and why access is needed.' }) @IsString() @Length(10, 500) reason!: string;
}

@Controller('v1/support')
@UseGuards(JwtIdentityGuard)
export class SupportAccessController {
  constructor(private readonly support: SupportAccessService) {}

  @Get('venues')
  venues(@Req() request: Request) { return this.support.venues(request.identity); }

  @Post('access')
  enter(@Req() request: Request, @Body() dto: EnterSupportVenueDto) {
    return this.support.enter(request.identity, dto.venueId, dto.reason);
  }

  @Post('access/exit')
  exit(@Req() request: Request) { return this.support.exit(request.identity); }
}
