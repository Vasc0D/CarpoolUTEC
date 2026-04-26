import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * H-1: Fixes a TOCTOU race in solicitSeat — two simultaneous requests from the
 * same passenger both pass the in-code "no active booking" check and create
 * duplicate active bookings.
 *
 * A partial unique index lets PostgreSQL enforce the constraint atomically:
 * only one row per passenger may exist with status PENDING or ACCEPTED.
 * Any concurrent second insert is rejected by the DB engine itself, not
 * by application code.
 */
export class AddUniqueActiveBookingPerPassenger1745500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_booking_passenger_active"
      ON "bookings" ("passengerId")
      WHERE status IN ('PENDING', 'ACCEPTED')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_booking_passenger_active"
    `);
  }
}
