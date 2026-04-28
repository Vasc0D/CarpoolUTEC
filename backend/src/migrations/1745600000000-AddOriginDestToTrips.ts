import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds tripOrigin and finalDestination JSON columns to the trips table.
 * These store the exact coordinates supplied at trip creation time and are
 * used as the authoritative source for route recalculations, replacing the
 * previous pattern of deriving origin/destination from the stored
 * overview_polyline endpoints (which drift across recalculations).
 * Existing rows remain NULL and fall back to the polyline-endpoint logic.
 */
export class AddOriginDestToTrips1745600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        ADD COLUMN IF NOT EXISTS "tripOrigin" json NULL,
        ADD COLUMN IF NOT EXISTS "finalDestination" json NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trips"
        DROP COLUMN IF EXISTS "tripOrigin",
        DROP COLUMN IF EXISTS "finalDestination"
    `);
  }
}
