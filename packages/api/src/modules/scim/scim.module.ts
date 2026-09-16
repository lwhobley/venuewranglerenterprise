import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ScimController } from './scim.controller';

@Module({
  imports: [PrismaModule, ConfigModule],
  controllers: [ScimController],
})
export class ScimModule {}
