import './telemetry';
import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { RequestObservabilityMiddleware } from './request-observability';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'], rawBody: true });
  app.setGlobalPrefix('api');
  const requestObservability = new RequestObservabilityMiddleware();
  app.use(requestObservability.use.bind(requestObservability));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (corsOrigins.length === 0 || corsOrigins.includes('*')) throw new Error('CORS_ORIGINS must contain explicit origins.');
  app.enableCors({ origin: corsOrigins, credentials: true, exposedHeaders: ['x-request-id'] });
  const openApi = new DocumentBuilder().setTitle('Venue Wrangler API').setDescription('Versioned event operations API').setVersion('1.0.0').addBearerAuth().build();
  SwaggerModule.setup('openapi', app, SwaggerModule.createDocument(app, openApi));
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
