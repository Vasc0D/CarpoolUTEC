import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security headers (X-Frame-Options, X-Content-Type-Options, HSTS, etc.)
  app.use(helmet());

  // CORS — restrict to known client origins. Includes Idempotency-Key so
  // browsers can send it on cross-origin retries.
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['exp://127.0.0.1:8081', 'exp://localhost:8081'];
  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Idempotency-Key support for mutating endpoints. Opt-in: clients only need
  // to send the header on flows that must run at most once (booking creation,
  // accept, etc.). The interceptor short-circuits replays with the cached
  // response and rejects key reuse with a different body.
  app.useGlobalInterceptors(new IdempotencyInterceptor());

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
