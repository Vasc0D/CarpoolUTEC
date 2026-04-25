import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDetourFieldsToTrips1745100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips"
        ADD COLUMN IF NOT EXISTS "detourEnabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "originalDurationSeconds" int NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "passengerWaypoints" json`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "trips"
        DROP COLUMN IF EXISTS "detourEnabled",
        DROP COLUMN IF EXISTS "originalDurationSeconds",
        DROP COLUMN IF EXISTS "passengerWaypoints"`,
    );
  }
}
