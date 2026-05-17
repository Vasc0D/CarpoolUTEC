import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAsyncRouteStatuses1745750000000 implements MigrationInterface {
  transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bookings_status_enum') THEN
          ALTER TYPE "bookings_status_enum" ADD VALUE IF NOT EXISTS 'PENDING_ROUTE_RECALC';
          ALTER TYPE "bookings_status_enum" ADD VALUE IF NOT EXISTS 'ROUTE_RECALC_FAILED';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trips_status_enum') THEN
          ALTER TYPE "trips_status_enum" ADD VALUE IF NOT EXISTS 'BOARDING';
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_booking_passenger_active";
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_booking_passenger_active"
      ON "bookings" ("passengerId")
      WHERE status IN ('PENDING', 'PENDING_ROUTE_RECALC', 'ACCEPTED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_booking_passenger_active";
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_booking_passenger_active"
      ON "bookings" ("passengerId")
      WHERE status IN ('PENDING', 'ACCEPTED')
    `);
  }
}
