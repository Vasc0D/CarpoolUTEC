import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { TripsModule } from './trips/trips.module';
import { NotificationsModule } from './notifications/notifications.module';
import { GeoModule } from './geo/geo.module';
import { BookingsModule } from './bookings/bookings.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // 1. Carga las variables de entorno desde el archivo .env
    ConfigModule.forRoot({
      isGlobal: true, // Permite usar ConfigService en cualquier módulo sin importarlo de nuevo
    }),
    
    // 2. Configura la conexión a PostgreSQL
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      autoLoadEntities: true,      // Escanea y carga los archivos .entity.ts automáticamente
      synchronize: true,           // Sincroniza el esquema de DB (solo para desarrollo, apagar en prod)
    }),

    // 3. Tus módulos de la arquitectura
    UsersModule,
    TripsModule,
    NotificationsModule,
    GeoModule,
    BookingsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}