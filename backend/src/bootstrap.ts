import './common/env';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { isServerless } from './common/runtime';

/**
 * Builds the configured Nest application without starting a listener.
 *
 * Shared by the local server (`main.ts`, which calls `listen`) and the
 * serverless handler (`api/index.ts`, which hands the Express instance to the
 * platform). Keeping one factory means the two deployments cannot drift apart
 * in middleware, validation or error handling — a class of bug that only ever
 * shows up in production.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // The platform captures stdout; verbose Nest boot logs on every cold start
    // are noise, but warnings and errors still matter.
    logger: isServerless() ? ['error', 'warn', 'log'] : undefined,
  });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(compression());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // Uploaded files are served off disk only in development. In production they
  // live in blob storage and are fetched from their own absolute URLs, so there
  // is no local directory to expose.
  if (!isServerless()) {
    app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/api/uploads/' });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Solar Store Management API')
    .setDescription('REST API for the solar equipment retail store management system')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, { swaggerOptions: { persistAuthorization: true } });

  return app;
}

/**
 * Allowed browser origins.
 *
 * `origin: true` reflects whatever origin asks, which is convenient locally and
 * too permissive once the API is on the public internet. Set CORS_ORIGINS to a
 * comma-separated list of the deployed frontend URLs to lock it down.
 */
function corsOrigins(): string[] | boolean {
  const configured = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
  return configured?.length ? configured : true;
}

export type { INestApplication };
