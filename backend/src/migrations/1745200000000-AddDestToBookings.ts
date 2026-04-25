import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDestToBookings1745200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings"
        ADD COLUMN IF NOT EXISTS "destLat" numeric(9,6),
        ADD COLUMN IF NOT EXISTS "destLng" numeric(9,6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bookings"
        DROP COLUMN IF EXISTS "destLat",
        DROP COLUMN IF EXISTS "destLng"`,
    );
  }
}
