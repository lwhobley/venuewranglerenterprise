import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { DocumentsModule } from '../documents/documents.module';
import { StadiumModule } from '../stadium/stadium.module';
import { BeoHubController } from './beo-hub.controller';
import { BeoIngestService } from './beo-ingest.service';
import { StubCrmProvider } from './providers/stub-crm.provider';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    StadiumModule,
    DocumentsModule,
  ],
  controllers: [BeoHubController],
  providers: [
    BeoIngestService,
    StubCrmProvider,
  ],
  exports: [
    BeoIngestService,
  ],
})
export class BeoHubModule {}
