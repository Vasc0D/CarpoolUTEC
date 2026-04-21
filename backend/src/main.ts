// backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Activa validación global con los DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,       // Elimina campos no declarados en el DTO
    forbidNonWhitelisted: true,
    transform: true,       // Convierte strings a números donde el DTO lo espera (capacity)
  }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();